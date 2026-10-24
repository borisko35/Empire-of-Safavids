export function должен(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

export function должны(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}