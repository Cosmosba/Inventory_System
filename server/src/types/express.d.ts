export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  employeeId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionId?: string;
    }
  }
}
