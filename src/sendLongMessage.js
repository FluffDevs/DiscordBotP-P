// Helper to send long messages by splitting them for Discord's 2000-char limit,
// or by attaching a file when the content exceeds a configured logical limit.
import fs from 'fs';

const DISCORD_MAX = 2000;
const DEFAULT_LOGICAL_MAX = 50000; // logical maximum requested by user

export async function sendLong(channel, content, options = {}) {
  if (!channel || !content) return;
  const logicalMax = Number(process.env.MAX_RESPONSE_LENGTH ?? DEFAULT_LOGICAL_MAX);

  // If content is longer than the logical maximum, send as an attached file to preserve all data
  if (content.length > logicalMax) {
    try {
      const buffer = Buffer.from(content, 'utf8');
      await channel.send(Object.assign({}, options, { files: [{ attachment: buffer, name: 'message.txt' }] }));
      return;
    } catch (err) {
      // fallback to chunked sending if attachment fails
    }
  }

  // Send in 2000-char chunks (Discord limit)
  for (let i = 0; i < content.length; i += DISCORD_MAX) {
    const chunk = content.slice(i, i + DISCORD_MAX);
    try {
      await channel.send(Object.assign({}, options, { content: chunk }));
    } catch (err) {
      // ignore send errors for chunks
    }
    // small delay to reduce risk of hitting rate limits
    await new Promise(r => setTimeout(r, 150));
  }
}

export default sendLong;
