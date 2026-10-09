/** Deliberately narrow local courtesy handling, not a general intent classifier. */
export function courtesyReply(body: string): string | undefined {
  const text = body.trim().toLowerCase().replace(/[!.,?]+$/u, '').trim();
  if (/^(hi|hello|hey|hiya|howdy|good morning|good afternoon|good evening)( (there|everyone|all|team|roundtable))?$/.test(text)) return 'Hello! What would you like to work on?';
  if (/^(thanks|thank you|thanks everyone|thank you all|cheers)$/.test(text)) return 'You’re welcome.';
  return undefined;
}
