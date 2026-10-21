/** Deliberately narrow local courtesy handling, not a general intent classifier. */
export function courtesyReply(body: string): string | undefined {
  // Only terminal punctuation is decorative; interior punctuation or newlines may signal a request.
  const text = body.trim().toLowerCase().replace(/[!.,?\u2026\uFF01\uFF0E\uFF0C\uFF1F]+$/u, '').trim();
  if (/^(hi|hello|hey|hiya|howdy|good morning|good afternoon|good evening)( (there|everyone|all|team|roundtable))?$/.test(text)) return 'Hello! What would you like to work on?';
  if (/^(thanks|thank you)(,? (everyone|all|team))?$|^cheers$/.test(text)) return 'You’re welcome.';
  return undefined;
}
