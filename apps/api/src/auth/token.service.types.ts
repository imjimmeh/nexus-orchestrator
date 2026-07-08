export interface TokenPayload {
  sub: string;
  username: string;
  email: string;
  roles: string[];
}

export interface TokenPair {
  accessToken: string;
  expiresIn: number;
}
