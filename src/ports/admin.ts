export interface ManagementSessions {
    require(request: Request): Promise<{ csrf: string; email: string }>;
    logout(request: Request): Promise<string>;
}
