export default {
  name: 'ping',
  description: 'Répond pong',
  async execute(message /*, args */) {
    return message.reply('Pong 🏓');
  }
};
