import { readFileSync } from 'node:fs';
import type { Approver } from '../reporting/reporting.repository.js';

export interface User {
  id: string;
  name: string;
  role: string;
}

/**
 * STUB: user directory = approvers.csv (people) + config/service-users.json (the Intake
 * service account) — prod: identities and roles come from Ridgeline's IdP (OIDC/SAML groups).
 */
export class UsersDirectory {
  private readonly users = new Map<string, User>();

  constructor(users: User[]) {
    users.forEach((u) => this.users.set(u.id, u));
  }

  static from(approvers: Approver[], serviceUsersPath: string): UsersDirectory {
    const service = JSON.parse(
      readFileSync(serviceUsersPath, 'utf8'),
    ) as User[];
    return new UsersDirectory([
      ...approvers.map((a) => ({
        id: a.approverId,
        name: a.name,
        role: a.role,
      })),
      ...service,
    ]);
  }

  find(id: string): User | undefined {
    return this.users.get(id);
  }
}
