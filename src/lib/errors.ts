/** Turns database, network and file errors into a sentence a teacher can act on. */
export function friendlyError(e: unknown): string {
  const err = (e ?? {}) as { message?: string };
  const msg = err.message ?? (typeof e === 'string' ? e : 'Something went wrong. Try again.');

  if (/UNIQUE constraint failed: index 'classes_name_unique'/.test(msg)) return 'There is already a class with that name.';
  if (/UNIQUE constraint failed: (index 'class_names_unique'|.*class_names)/.test(msg)) return 'That name is already on the class list.';
  if (/UNIQUE constraint failed: saved_scripts/.test(msg)) return 'A score is already saved for this name in this class.';
  if (/UNIQUE constraint failed/.test(msg)) return 'That name is already in use.';
  if (/FOREIGN KEY constraint failed/.test(msg)) return "It's used by an exam, so it can't be deleted.";
  if (/network request failed|failed to fetch|fetch failed|network error/i.test(msg)) {
    return 'No internet connection. Check your data and try again.';
  }
  // Messages written for the teacher (thrown by Skora itself) pass through unchanged.
  return msg.replace(/^Error code \d+: /, '').replace(/^Calling the '\w+' function has failed\s*→\s*Caused by:\s*/i, '');
}
