import type { Pool } from 'pg';

export interface User {
  id: string;
  email: string;
  name: string;
}

export class UserService {
  constructor(private readonly db: Pool) {}

  async findById(id: string): Promise<User | null> {
    const result = await this.db.query<User>(
      'SELECT id, email, name FROM users WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async update(id: string, patch: Partial<Pick<User, 'email' | 'name'>>): Promise<void> {
    const fields = Object.keys(patch) as Array<keyof typeof patch>;
    if (fields.length === 0) return;
    const setClauses = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [id, ...fields.map((k) => patch[k])];
    await this.db.query(`UPDATE users SET ${setClauses} WHERE id = $1`, values);
  }
}
