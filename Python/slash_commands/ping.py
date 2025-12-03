"""Slash /ping"""
name = 'ping'
description = 'Répond pong (slash) 🏓'

async def execute(interaction, **kwargs):
    try:
        await interaction.response.send_message('Pong 🏓 (slash)')
    except Exception:
        try:
            if not interaction.response.is_done():
                await interaction.followup.send('Pong 🏓 (slash)')
        except Exception:
            pass
