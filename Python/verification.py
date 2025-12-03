"""Gestionnaire de vérifications traduit en style OOP.

Ce module reprend la logique du fichier JS en tentant de garder le même
comportement (DM -> publication forum -> validation par staff). Certaines
opérations dépendent de la version de `discord.py`; le code est robuste et
utilise des fallback si l'API exacte n'est pas disponible.
"""
import os
import json
import asyncio
import time
from pathlib import Path
from logger import Logger
from telegram_bridge import get_bridge
from send_long import send_long


class VerificationManager:
    def __init__(self, client, logger: Logger = None, telegram_bridge=None):
        self.client = client
        self.logger = logger or Logger()
        self.telegram = telegram_bridge or get_bridge()
        # store data under Python/data to keep Python artifacts together
        base_dir = Path(__file__).resolve().parent
        self.data_dir = base_dir / 'data'
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.store_file = self.data_dir / 'verifications.json'
        self.store = {'verifications': {}}
        self._load_store()
        # cooldown map for request_verif button
        self._last_request = {}

    def _load_store(self):
        try:
            if self.store_file.exists():
                raw = self.store_file.read_text(encoding='utf8')
                self.store = json.loads(raw or '{}')
                if 'verifications' not in self.store:
                    self.store['verifications'] = {}
        except Exception:
            self.store = {'verifications': {}}

    def _save_store(self):
        try:
            self.store_file.write_text(json.dumps(self.store, indent=2, ensure_ascii=False), encoding='utf8')
        except Exception:
            pass

    async def try_role_operation(self, op_coro, context_msg: str, channel=None):
        # Retry transient errors
        delays = [0.5, 1.5, 3.5]
        for attempt, delay in enumerate([0, *delays], start=1):
            try:
                if attempt > 1:
                    await asyncio.sleep(delay)
                await op_coro()
                return True
            except Exception as e:
                msg = str(e)
                transient = '429' in msg or 'rate' in msg.lower() or 'timeout' in msg.lower()
                self.logger.warn(f"Tentative {attempt} échouée pour {context_msg}: {msg}")
                if not transient or attempt >= len(delays) + 1:
                    if channel:
                        try:
                            await channel.send(f"⚠️ Erreur: impossible de {context_msg}. Détails: {msg}")
                        except Exception:
                            pass
                    return False
        return False

    def attach_handlers(self):
        # Attach event handlers to the client. Use best-effort to map behavior.

        @self.client.event
        async def on_ready():
            self.logger.info('VerificationManager attached handlers (ready)')

        @self.client.event
        async def on_member_join(member):
            try:
                await self.run_verification_for_member(member)
            except Exception as e:
                self.logger.error(f'Erreur run verification: {e}')

        @self.client.event
        async def on_interaction(interaction):
            try:
                # Button request_verif
                if getattr(interaction, 'type', None) is not None:
                    # discord.py has many interaction types; check custom_id
                    cid = getattr(interaction, 'data', {}).get('custom_id') if getattr(interaction, 'data', None) else None
                    # some versions expose custom_id at interaction.data['custom_id']
                    if not cid:
                        try:
                            cid = interaction.data.get('custom_id')
                        except Exception:
                            cid = None
                    if cid == 'request_verif' or getattr(interaction, 'custom_id', None) == 'request_verif':
                        await interaction.response.defer(ephemeral=True)
                        # try to fetch member
                        member = None
                        try:
                            member = interaction.guild.get_member(interaction.user.id)
                        except Exception:
                            member = None
                        # cooldown
                        now = int(time.time() * 1000)
                        last = self._last_request.get(interaction.user.id, 0)
                        if now - last < 3 * 60 * 1000:
                            remaining = int((3 * 60 * 1000 - (now - last)) / 1000)
                            await interaction.followup.send(f'🔁 Tu as récemment demandé une vérification. Merci d\'attendre {remaining} secondes.', ephemeral=True)
                            return
                        self._last_request[interaction.user.id] = now
                        # run verification for member object if we can resolve it
                        target_member = None
                        try:
                            if interaction.guild:
                                target_member = await interaction.guild.fetch_member(interaction.user.id)
                        except Exception:
                            target_member = None
                        if not target_member:
                            try:
                                # attempt to use interaction.user as partial member
                                target_member = interaction.user
                            except Exception:
                                target_member = None
                        if target_member:
                            await self.run_verification_for_member(target_member)
                            await interaction.followup.send("Le message de vérification t'a été envoyé en DM (si tes DMs sont ouverts).", ephemeral=True)
                        else:
                            await interaction.followup.send("Impossible de lancer la vérification (membre introuvable).", ephemeral=True)

            except Exception:
                pass

        @self.client.event
        async def on_message(message):
            try:
                if message.author.bot:
                    return
                # global cancel command (annuler)
                text = (message.content or '').lower().strip()
                import re
                if not re.match(r"^\s*(?:annuler|cancel|revoquer|revoqu[eé]|stop)\b", text):
                    return
                guild = message.guild
                if not guild:
                    return
                member = await guild.fetch_member(message.author.id)
                allowed = False
                try:
                    if member.guild_permissions.manage_guild:
                        allowed = True
                except Exception:
                    allowed = False
                verifier_role = os.getenv('VERIFIER_ROLE')
                if not allowed and verifier_role and member:
                    try:
                        if any(r.name == verifier_role for r in member.roles):
                            allowed = True
                    except Exception:
                        pass
                if not allowed:
                    await message.channel.send(f"<@{message.author.id}> Vous n'êtes pas autorisé·e à annuler une vérification.")
                    return

                # extract target id from mentions or content
                target_id = None
                if message.mentions and message.mentions.users:
                    first = list(message.mentions.users)[0]
                    target_id = getattr(first, 'id', None)
                if not target_id:
                    m = re.search(r"verification_member_id:(\d+)", message.content)
                    if m:
                        target_id = m.group(1)
                if not target_id:
                    m2 = re.search(r"<@!?(\d+)>", message.content)
                    if m2:
                        target_id = m2.group(1)
                if not target_id:
                    m3 = re.search(r"(?:^|\D)(\d{16,19})(?:\D|$)", message.content)
                    if m3:
                        target_id = m3.group(1)
                if not target_id:
                    return
                await self.handle_cancel(guild, message.channel, message.author, target_id)
            except Exception as e:
                self.logger.error(f'on_message verification handler error: {e}')

        @self.client.event
        async def on_raw_reaction_add(payload):
            # best-effort: payload may be RawReactionActionEvent without message or guild objects
            try:
                if str(payload.user_id) == str(self.client.user.id):
                    return
                emoji = getattr(payload, 'emoji', None)
                name = getattr(emoji, 'name', str(emoji))
                if name not in ('✅', '❌'):
                    return
                guild = None
                try:
                    guild = self.client.get_guild(payload.guild_id)
                except Exception:
                    guild = None
                if not guild:
                    return
                member = await guild.fetch_member(payload.user_id)
                allowed = False
                try:
                    if member.guild_permissions.manage_guild:
                        allowed = True
                except Exception:
                    allowed = False
                verifier_role = os.getenv('VERIFIER_ROLE')
                if not allowed and verifier_role and member:
                    try:
                        if any(r.name == verifier_role for r in member.roles):
                            allowed = True
                    except Exception:
                        pass
                if not allowed:
                    return

                # Try to resolve targetId via thread topic or message content
                target_id = None
                # Try thread topic (payload.channel_id points to thread)
                try:
                    channel = await self.client.fetch_channel(payload.channel_id)
                    topic = getattr(channel, 'topic', '') or ''
                    import re
                    m = re.search(r"verification:(\d+)", topic)
                    if m:
                        target_id = m.group(1)
                except Exception:
                    pass
                if not target_id:
                    try:
                        msg = await channel.fetch_message(payload.message_id)
                        if msg and msg.content:
                            m2 = re.search(r"verification_member_id:(\d+)", msg.content)
                            if m2:
                                target_id = m2.group(1)
                    except Exception:
                        pass
                if not target_id:
                    # fallback: search store by thread id
                    try:
                        for mid, info in (self.store.get('verifications') or {}).items():
                            if info and str(info.get('threadId')) == str(payload.channel_id):
                                target_id = mid
                                break
                    except Exception:
                        pass
                if not target_id:
                    return

                if name == '✅':
                    await self.handle_accept(guild, channel, member, target_id)
                elif name == '❌':
                    await self.handle_reject(guild, channel, member, target_id)
            except Exception as e:
                self.logger.error(f'on_raw_reaction_add error: {e}')

        @self.client.event
        async def on_message_edit(before, after):
            # ignore for now
            return

    async def run_verification_for_member(self, member):
        try:
            self.logger.info(f'Lancement vérification pour: {getattr(member, "user", member)}')
            non_verified_role = os.getenv('NON_VERIFIED_ROLE')
            # add non-verified role if configured
            if non_verified_role and hasattr(member, 'roles'):
                try:
                    guild = member.guild
                    r = None
                    if non_verified_role.isdigit():
                        r = guild.get_role(int(non_verified_role))
                    if not r:
                        for rr in guild.roles:
                            if rr.name == non_verified_role:
                                r = rr
                                break
                    if r:
                        await member.add_roles(r)
                except Exception:
                    pass

            # open DM
            dm = None
            try:
                dm = await member.create_dm()
            except Exception:
                dm = None

            questions_env = os.getenv('QUESTIONS')
            verif_md = os.getenv('VERIF_MESSAGE_MD')
            DEFAULT_QUESTIONS = [
                "Bonjour ! Peux-tu te présenter en quelques lignes ?",
                "Quel âge as-tu ?",
                "D'où viens-tu (pays / région) ?",
                "As-tu lu et accepté les règles du serveur ?"
            ]

            questions = DEFAULT_QUESTIONS
            if questions_env:
                try:
                    parsed = json.loads(questions_env)
                    if isinstance(parsed, list) and parsed:
                        questions = parsed
                except Exception:
                    verif_md = questions_env
                    questions = []

            answers = []
            if dm:
                try:
                    if verif_md:
                        try:
                            await send_long(dm, verif_md)
                        except Exception:
                            try:
                                await dm.send(verif_md)
                            except Exception:
                                pass
                        try:
                            await dm.send("Merci : réponds à ces questions dans ce DM. Tape `done` quand tu as fini (ou attends 10 minutes).")
                        except Exception:
                            pass

                        collected = []
                        def check(m):
                            return m.author.id == getattr(member, 'id', None)

                        try:
                            while True:
                                m = await self.client.wait_for('message', timeout=10 * 60, check=check)
                                if m.content and m.content.lower().strip() == 'done':
                                    break
                                collected.append(m.content)
                        except asyncio.TimeoutError:
                            pass

                        combined = '\n\n'.join(collected) if collected else 'Aucune réponse'
                        answers.append({'question': 'Réponses', 'answer': combined})
                        try:
                            if collected:
                                await dm.send('Votre vérification a bien été reçue et sera bientôt traitée.')
                        except Exception:
                            pass
                    else:
                        for q in questions:
                            try:
                                await dm.send(q)
                                def check(m):
                                    return m.author.id == getattr(member, 'id', None)
                                try:
                                    m = await self.client.wait_for('message', timeout=10 * 60, check=check)
                                    answers.append({'question': q, 'answer': m.content})
                                except asyncio.TimeoutError:
                                    answers.append({'question': q, 'answer': 'Pas de réponse (temps écoulé)'})
                            except Exception:
                                answers.append({'question': q, 'answer': 'Erreur en envoi DM'})
                except Exception as e:
                    self.logger.warn(f'Erreur DM during verification: {e}')
            else:
                for q in questions:
                    answers.append({'question': q, 'answer': 'Pas de réponse (DM fermé)'})

            # publish to forum
            forum_channel_id = os.getenv('FORUM_CHANNEL_ID')
            if not forum_channel_id:
                self.logger.warn('FORUM_CHANNEL_ID non défini, impossible de poster les réponses de vérification.')
                return

            forum = None
            try:
                if str(forum_channel_id).isdigit():
                    forum = await self.client.fetch_channel(int(forum_channel_id))
            except Exception:
                forum = None
            if not forum:
                # try by name across guilds
                for g in self.client.guilds:
                    try:
                        for c in g.channels:
                            try:
                                if getattr(c, 'name', None) == forum_channel_id:
                                    forum = c
                                    break
                            except Exception:
                                continue
                        if forum:
                            break
                    except Exception:
                        continue

            if not forum:
                self.logger.warn('Impossible de récupérer le forum (FORUM_CHANNEL_ID incorrect)')
                return

            title = f"{getattr(member, 'nick', None) or getattr(member, 'name', getattr(member, 'user', member))}"
            content_lines = []
            notify_role = os.getenv('NOTIFY_ROLE_ID') or '1440249794965541014'
            notify_mention = f"<@&{notify_role}>" if notify_role else ''
            content_lines.append(f"Nouvelle demande de vérification pour: **{getattr(member, 'user', member)}** (<@{getattr(member, 'id', '')}>) Accepter : oui/non {notify_mention}")
            content_lines.append('---')
            for a in answers:
                content_lines.append(f"**{a['question']}**\n{a['answer']}")
            content_lines.append('\n\n*Meta: verification_member_id:' + str(getattr(member, 'id', 'unknown') ) + '*')
            post_content = '\n\n'.join(content_lines)

            # create thread if possible, otherwise send message
            thread = None
            try:
                first_chunk = post_content[:1900]
                remaining = post_content[1900:]
                # attempt to create a thread (API may vary)
                try:
                    # discord.py ForumChannel has create_thread in some versions
                    thread = await forum.create_thread(name=title, auto_archive_duration=10080, content=first_chunk)
                except Exception:
                    try:
                        thread = await forum.threads.create(name=title, auto_archive_duration=10080, message=first_chunk)
                    except Exception:
                        # fallback: send as normal message
                        sent = await forum.send(first_chunk)
                        thread = None
                if remaining:
                    if thread:
                        try:
                            await send_long(thread, remaining)
                        except Exception:
                            try:
                                await thread.send(remaining)
                            except Exception:
                                pass
                    else:
                        try:
                            await send_long(forum, remaining)
                        except Exception:
                            try:
                                await forum.send(remaining)
                            except Exception:
                                pass
            except Exception as e:
                self.logger.error(f'Erreur en créant le thread/forum post: {e}')
                return

            # forward to telegram
            try:
                tgtext = f"Nouvelle vérification pour {getattr(member, 'user', member)} ({getattr(member, 'id', '')})\n\n" + '\n\n'.join(content_lines)
                try:
                    self.telegram.enqueue_verification(tgtext)
                except Exception:
                    pass
            except Exception:
                pass

            # save store mapping
            try:
                thread_id = getattr(thread, 'id', None) if thread else None
                self.store['verifications'][str(getattr(member, 'id', ''))] = { 'threadId': thread_id, 'channelId': forum_channel_id, 'createdAt': int(time.time()*1000), 'awaitingValidation': True }
                self._save_store()
            except Exception:
                pass

        except Exception as e:
            self.logger.error(f'Erreur dans runVerificationForMember: {e}')

    async def handle_accept(self, guild, channel, moderator_user, target_id):
        try:
            # prevent double-processing
            try:
                existing = self.store.get('verifications', {}).get(str(target_id), {})
                if existing.get('status') in ('cancelled', 'accepted', 'processing'):
                    await channel.send('Cette vérification est déjà traitée ou annulée.')
                    return
                self.store['verifications'][str(target_id)] = { **existing, 'status': 'processing', 'awaitingValidation': False }
                self._save_store()
            except Exception:
                pass

            target = None
            try:
                target = await guild.fetch_member(int(target_id))
            except Exception:
                try:
                    target = guild.get_member(int(target_id))
                except Exception:
                    target = None
            if not target:
                await channel.send('Membre visé introuvable sur le serveur.')
                return

            # remove non-verified role
            non_verified_role = os.getenv('NON_VERIFIED_ROLE')
            if non_verified_role:
                try:
                    r = None
                    if str(non_verified_role).isdigit():
                        r = guild.get_role(int(non_verified_role))
                    if not r:
                        for rr in guild.roles:
                            if rr.name == non_verified_role:
                                r = rr
                                break
                    if r:
                        await self.try_role_operation(lambda: target.remove_roles(r), f"retirer le rôle {r}", channel)
                except Exception:
                    pass

            # add peluche role
            peluche_role = os.getenv('PELUCHER_ROLE') or os.getenv('PELUCHES_ROLE') or os.getenv('PELUCHER')
            if peluche_role:
                try:
                    r2 = None
                    if str(peluche_role).isdigit():
                        r2 = guild.get_role(int(peluche_role))
                    if not r2:
                        for rr in guild.roles:
                            if rr.name == peluche_role:
                                r2 = rr
                                break
                    if r2:
                        await self.try_role_operation(lambda: target.add_roles(r2), f"ajouter le rôle {r2}", channel)
                except Exception:
                    pass

            try:
                try:
                    await target.send(f"Félicitations — votre vérification a été acceptée sur {guild.name}. Vous avez reçu le rôle.")
                except Exception:
                    pass
                await channel.send(f"✅ Vérification acceptée par <@{getattr(moderator_user, 'id', moderator_user)}> — rôle appliqué à <@{target.id}>.")
            except Exception:
                pass

            # handle age/artiste prompts simplified
            try:
                applied_roles = []
                major_role = os.getenv('MAJOR_ROLE')
                minor_role = os.getenv('MINOR_ROLE')
                artist_role = os.getenv('ARTIST_ROLE') or os.getenv('ARTIST_ROLE_ID') or os.getenv('ARTIST_ROLE_TAG')
                moderator_id = getattr(moderator_user, 'id', moderator_user)
                # ask in channel for majeur/mineur (simplified)
                if major_role or minor_role:
                    await channel.send(f"<@{moderator_id}> Le membre est-il **majeur** ou **mineur** ? (majeur / mineur) — vous avez 5 minutes.")
                    def check(m):
                        return m.author.id == moderator_id and m.channel.id == channel.id
                    try:
                        m = await self.client.wait_for('message', timeout=5*60, check=check)
                        ans = m.content.strip().lower()
                        if ans.startswith('majeur') and major_role:
                            # resolve role
                            rr = None
                            try:
                                if str(major_role).isdigit():
                                    rr = guild.get_role(int(major_role))
                                else:
                                    for r in guild.roles:
                                        if r.name == major_role:
                                            rr = r; break
                            except Exception:
                                rr = None
                            if rr:
                                await self.try_role_operation(lambda: target.add_roles(rr), f"ajouter le rôle {rr}", channel)
                                applied_roles.append(rr.name if hasattr(rr, 'name') else str(rr))
                        elif ans.startswith('mineur') and minor_role:
                            rr = None
                            try:
                                if str(minor_role).isdigit():
                                    rr = guild.get_role(int(minor_role))
                                else:
                                    for r in guild.roles:
                                        if r.name == minor_role:
                                            rr = r; break
                            except Exception:
                                rr = None
                            if rr:
                                await self.try_role_operation(lambda: target.add_roles(rr), f"ajouter le rôle {rr}", channel)
                                applied_roles.append(rr.name if hasattr(rr, 'name') else str(rr))
                    except asyncio.TimeoutError:
                        await channel.send("Pas de réponse — rôle d'âge non attribué.")

                # artist prompt
                if artist_role:
                    await channel.send(f"<@{moderator_id}> Voulez-vous attribuer le rôle 'artiste' à <@{target.id}> ? (oui / non) — vous avez 5 minutes.")
                    def check2(m):
                        return m.author.id == moderator_id and m.channel.id == channel.id
                    try:
                        m2 = await self.client.wait_for('message', timeout=5*60, check=check2)
                        reply = m2.content.strip().lower()
                        if reply.startswith('oui'):
                            rr = None
                            try:
                                if artist_role.startswith('<@&'):
                                    aid = ''.join(ch for ch in artist_role if ch.isdigit())
                                    rr = guild.get_role(int(aid))
                                elif str(artist_role).isdigit():
                                    rr = guild.get_role(int(artist_role))
                                else:
                                    for r in guild.roles:
                                        if r.name == artist_role:
                                            rr = r; break
                            except Exception:
                                rr = None
                            if rr:
                                await self.try_role_operation(lambda: target.add_roles(rr), f"ajouter le rôle {rr}", channel)
                                applied_roles.append(rr.name if hasattr(rr, 'name') else str(rr))
                                await channel.send(f"Rôle \"{rr.name}\" attribué à <@{target.id}>.")
                    except asyncio.TimeoutError:
                        await channel.send("Pas de réponse — pas d'attribution du rôle 'artiste'.")

                summary = ', '.join(applied_roles) if applied_roles else 'aucun rôle supplémentaire'
                await channel.send(f"Vérification terminée — rôles appliqués pour <@{target.id}> : {summary}")
            except Exception as e:
                self.logger.warn(f'Erreur lors du post-accept flow: {e}')

            # mark accepted
            try:
                existing2 = self.store.get('verifications', {}).get(str(target_id), {})
                self.store.setdefault('verifications', {})[str(target_id)] = { **existing2, 'status': 'accepted', 'acceptedAt': int(time.time()*1000) }
                self._save_store()
            except Exception:
                pass

            # notify telegram
            try:
                tgmsg = f"✅ Vérification ACCEPTÉE\nMembre: {getattr(target, 'user', target)} ({target.id})\nPar: {getattr(moderator_user, 'id', moderator_user)}\nGuild: {guild.id}"
                try:
                    self.telegram.enqueue_verification(tgmsg)
                except Exception:
                    pass
            except Exception:
                pass

        except Exception as err:
            self.logger.error(f'Erreur dans handle_accept: {err}')

    async def handle_reject(self, guild, channel, moderator_user, target_id):
        try:
            # mark awaitingValidation false
            try:
                existing = self.store.get('verifications', {}).get(str(target_id), {})
                self.store.setdefault('verifications', {})[str(target_id)] = { **existing, 'awaitingValidation': False }
                self._save_store()
            except Exception:
                pass

            target = None
            try:
                target = await guild.fetch_member(int(target_id))
            except Exception:
                pass
            if not target:
                await channel.send('Membre visé introuvable sur le serveur.')
                return

            await channel.send(f"<@{moderator_user.id}> Merci de fournir une justification du refus en répondant dans ce fil. Vous avez 30 minutes.")
            def check(m):
                return m.author.id == moderator_user.id and m.channel.id == channel.id
            try:
                m = await self.client.wait_for('message', timeout=30*60, check=check)
                justification = m.content
                try:
                    await target.send(f"Votre vérification a été refusée sur {guild.name}. Raison donnée par l'équipe :\n\n{justification}")
                except Exception:
                    pass
                await channel.send(f"Refus enregistré par <@{moderator_user.id}> et transmis au membre.")
                try:
                    self.telegram.enqueue_verification(f"❌ Vérification REFUSÉE\nMembre: {getattr(target, 'user', target)} ({target.id})\nPar: {getattr(moderator_user, 'id', moderator_user)}\nRaison: {justification}")
                except Exception:
                    pass
            except asyncio.TimeoutError:
                await channel.send('Aucune justification fournie — opération annulée.')
        except Exception as err:
            self.logger.error(f'Erreur dans handle_reject: {err}')

    async def handle_cancel(self, guild, channel, moderator_user, target_id):
        try:
            # mark awaitingValidation false
            try:
                existing = self.store.get('verifications', {}).get(str(target_id), {})
                self.store.setdefault('verifications', {})[str(target_id)] = { **existing, 'awaitingValidation': False }
                self._save_store()
            except Exception:
                pass

            target = None
            try:
                target = await guild.fetch_member(int(target_id))
            except Exception:
                pass
            if not target:
                await channel.send('Membre visé introuvable sur le serveur.')
                return

            await channel.send(f"<@{moderator_user.id}> Vous êtes sur le point d'annuler la vérification et de retirer TOUS les rôles de <@{target.id}>. Tapez la raison du refus dans les 30 minutes pour notifier le membre.")
            def check(m):
                return m.author.id == moderator_user.id and m.channel.id == channel.id
            try:
                m = await self.client.wait_for('message', timeout=30*60, check=check)
                justification = m.content or 'Aucune raison fournie'
                # try to remove roles
                try:
                    await self.try_role_operation(lambda: target.edit(roles=[]), f"retirer tous les rôles à {target.id}", channel)
                except Exception:
                    try:
                        # best-effort: remove roles one by one
                        role_ids = [r.id for r in getattr(target, 'roles', []) if getattr(r, 'id', None) and r.id != guild.id]
                        for rid in role_ids:
                            robj = guild.get_role(rid)
                            if robj:
                                await self.try_role_operation(lambda rid=rid: target.remove_roles(robj), f"retirer le rôle {robj}", channel)
                    except Exception:
                        pass

                non_verified_role = os.getenv('NON_VERIFIED_ROLE')
                if non_verified_role:
                    try:
                        r = None
                        if str(non_verified_role).isdigit():
                            r = guild.get_role(int(non_verified_role))
                        if not r:
                            for rr in guild.roles:
                                if rr.name == non_verified_role:
                                    r = rr; break
                        if r:
                            await self.try_role_operation(lambda: target.add_roles(r), f"ajouter le rôle non-vérifié {r}", channel)
                    except Exception:
                        pass

                try:
                    await target.send(f"Votre vérification sur {guild.name} a été annulée par l'équipe de modération. Raison donnée :\n\n{justification}")
                except Exception:
                    pass

                try:
                    self.store.setdefault('verifications', {})[str(target_id)] = { **(self.store.get('verifications', {}).get(str(target_id), {})), 'status': 'cancelled', 'cancelledAt': int(time.time()*1000), 'cancelledBy': getattr(moderator_user, 'id', moderator_user), 'cancelledReason': justification }
                    self._save_store()
                except Exception:
                    pass

                await channel.send(f"✅ Vérification annulée par <@{moderator_user.id}> et raison transmise au membre.")
                try:
                    self.telegram.enqueue_verification(f"❌ Vérification ANNULÉE\nMembre: {getattr(target, 'user', target)} ({target.id})\nPar: {getattr(moderator_user, 'id', moderator_user)}\nRaison: {justification}")
                except Exception:
                    pass
            except asyncio.TimeoutError:
                await channel.send('Aucune raison fournie — annulation abandonnée.')
        except Exception as err:
            self.logger.error(f'Erreur dans handle_cancel: {err}')