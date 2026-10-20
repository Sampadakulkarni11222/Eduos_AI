/**
 * The window event an ActionCard fires to open the assistant with a question
 * pre-filled. Its own tiny module so the assistant (on every page) can listen
 * for it without loading the generated-UI renderer and its schema library.
 */
export const ASK_EVENT = 'eduos:ask';
