/*
 * Radio Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Textes et questions du formulaire de vérification, en français et en anglais.
 * `questions` respecte la limite Discord de 5 champs maximum par Modal.
 * Surcouche possible via les variables d'env VERIF_QUESTIONS_FR / VERIF_QUESTIONS_EN
 * (JSON, même forme que les tableaux ci-dessous, max 5 entrées).
 */

const DEFAULT_QUESTIONS_FR = [
  { id: 'furry', label: 'Es-tu Furry ? Depuis quand ?', style: 'Short', required: true, maxLength: 200, placeholder: 'Ex : Oui, depuis 2019' },
  { id: 'discovery', label: 'Comment as-tu découvert le serveur ?', style: 'Short', required: true, maxLength: 200 },
  { id: 'artist', label: "Es-tu artiste (commissions) ?", style: 'Short', required: true, maxLength: 100, placeholder: 'Oui / Non + lien Insta/X si tu en as' },
  { id: 'age', label: 'Es-tu majeur ou mineur ?', style: 'Short', required: true, maxLength: 50, placeholder: 'majeur / mineur' },
  { id: 'presentation', label: 'Présente-toi en quelques lignes', style: 'Paragraph', required: true, maxLength: 1000 }
];

const DEFAULT_QUESTIONS_EN = [
  { id: 'furry', label: 'Are you a Furry? Since when?', style: 'Short', required: true, maxLength: 200, placeholder: 'E.g.: Yes, since 2019' },
  { id: 'discovery', label: 'How did you find this server?', style: 'Short', required: true, maxLength: 200 },
  { id: 'artist', label: 'Are you an artist (commissions)?', style: 'Short', required: true, maxLength: 100, placeholder: 'Yes / No + details' },
  { id: 'age', label: 'Are you an adult or a minor?', style: 'Short', required: true, maxLength: 50, placeholder: 'adult / minor' },
  { id: 'presentation', label: 'Introduce yourself briefly', style: 'Paragraph', required: true, maxLength: 1000 }
];

function loadQuestions(envVarName, fallback) {
  const raw = process.env[envVarName];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.length <= 5) return parsed;
  } catch (e) { /* ignore, use fallback */ }
  return fallback;
}

const questionsFr = loadQuestions('VERIF_QUESTIONS_FR', DEFAULT_QUESTIONS_FR);
const questionsEn = loadQuestions('VERIF_QUESTIONS_EN', DEFAULT_QUESTIONS_EN);

export const i18n = {
  fr: {
    langLabel: 'Français',
    langEmoji: '🇫🇷',
    langPrompt: 'Choisis ta langue / Choose your language :',
    modalTitle: 'Vérification — Radio Bot',
    questions: questionsFr,
    ephemeralConfirm: '✅ Merci ! Tes réponses ont été envoyées, vérifie tes DMs pour le récapitulatif.',
    confirmationMessage: 'Merci ! Tes réponses ont bien été reçues et transmises à l\'équipe de modération. 🎉',
    acceptedDM: (guildName) => `## ✅ Vérification acceptée\n\nFélicitations — ta vérification a été acceptée sur **${guildName}**. Tu as reçu le(s) rôle(s) correspondant(s). 🎉`,
    rejectedDM: (guildName, reason) => `## ❌ Vérification refusée\n\nTa vérification a été refusée sur **${guildName}**.\n\n**📝 Raison donnée par l'équipe :**\n> ${String(reason).replace(/\n/g, '\n> ')}`,
    cancelledDM: (guildName, reason) => `## 🚫 Vérification annulée\n\nTa vérification sur **${guildName}** a été annulée par l'équipe de modération.\n\n**📝 Raison donnée :**\n> ${String(reason).replace(/\n/g, '\n> ')}`,
    bannedDM: (guildName, reason) => `## 🔨 Bannissement\n\nTu as été banni·e de **${guildName}**.${reason ? `\n\n**📝 Raison donnée :**\n> ${String(reason).replace(/\n/g, '\n> ')}` : ''}`,
    kickedDM: (guildName, reason) => `## 👢 Expulsion\n\nTu as été expulsé·e de **${guildName}**.${reason ? `\n\n**📝 Raison donnée :**\n> ${String(reason).replace(/\n/g, '\n> ')}` : ''}`,
    rejectModalTitle: 'Raison du refus',
    cancelModalTitle: 'Raison de l\'annulation',
    reasonLabel: 'Raison',
    reasonPlaceholder: 'Explique brièvement la raison...'
  },
  en: {
    langLabel: 'English',
    langEmoji: '🇬🇧',
    langPrompt: 'Choose your language / Choisis ta langue :',
    modalTitle: 'Verification — Radio Bot',
    questions: questionsEn,
    ephemeralConfirm: '✅ Thanks! Your answers have been sent, check your DMs for a summary.',
    confirmationMessage: 'Thanks! Your answers have been received and forwarded to the moderation team. 🎉',
    acceptedDM: (guildName) => `## ✅ Verification accepted\n\nCongratulations — your verification has been accepted on **${guildName}**. You have received the corresponding role(s). 🎉`,
    rejectedDM: (guildName, reason) => `## ❌ Verification rejected\n\nYour verification has been rejected on **${guildName}**.\n\n**📝 Reason given by the staff:**\n> ${String(reason).replace(/\n/g, '\n> ')}`,
    cancelledDM: (guildName, reason) => `## 🚫 Verification cancelled\n\nYour verification on **${guildName}** has been cancelled by the moderation team.\n\n**📝 Reason given:**\n> ${String(reason).replace(/\n/g, '\n> ')}`,
    bannedDM: (guildName, reason) => `## 🔨 Ban\n\nYou have been banned from **${guildName}**.${reason ? `\n\n**📝 Reason given:**\n> ${String(reason).replace(/\n/g, '\n> ')}` : ''}`,
    kickedDM: (guildName, reason) => `## 👢 Kick\n\nYou have been kicked from **${guildName}**.${reason ? `\n\n**📝 Reason given:**\n> ${String(reason).replace(/\n/g, '\n> ')}` : ''}`,
    rejectModalTitle: 'Rejection reason',
    cancelModalTitle: 'Cancellation reason',
    reasonLabel: 'Reason',
    reasonPlaceholder: 'Briefly explain the reason...'
  }
};

export function resolveLang(lang) {
  return i18n[lang] ? lang : 'fr';
}

export default i18n;
