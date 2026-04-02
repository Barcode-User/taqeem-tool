import type { Browser, BrowserContext, Page } from "playwright";

export type AutomationSession = {
  sessionId: string;
  reportId: number;
  status: "running" | "waiting_otp" | "completed" | "failed";
  browser: Browser;
  context: BrowserContext;
  page: Page;
  otpResolver: ((otp: string) => void) | null;
  logs: string[];
  startedAt: Date;
};

const sessions = new Map<string, AutomationSession>();
const reportSessions = new Map<number, string>();

export function createSession(
  sessionId: string,
  reportId: number,
  browser: Browser,
  context: BrowserContext,
  page: Page,
): AutomationSession {
  const session: AutomationSession = {
    sessionId,
    reportId,
    status: "running",
    browser,
    context,
    page,
    otpResolver: null,
    logs: [],
    startedAt: new Date(),
  };
  sessions.set(sessionId, session);
  reportSessions.set(reportId, sessionId);
  return session;
}

export function getSession(sessionId: string): AutomationSession | undefined {
  return sessions.get(sessionId);
}

export function getSessionByReportId(reportId: number): AutomationSession | undefined {
  const sessionId = reportSessions.get(reportId);
  if (!sessionId) return undefined;
  return sessions.get(sessionId);
}

export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  try {
    await session.browser.close();
  } catch {}
  reportSessions.delete(session.reportId);
  sessions.delete(sessionId);
}

export function waitForOtp(session: AutomationSession): Promise<string> {
  session.status = "waiting_otp";
  return new Promise<string>((resolve) => {
    session.otpResolver = resolve;
  });
}

export function submitOtp(sessionId: string, otp: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || !session.otpResolver) return false;
  session.otpResolver(otp);
  session.otpResolver = null;
  session.status = "running";
  return true;
}

export function addLog(session: AutomationSession, message: string): void {
  const timestamp = new Date().toISOString();
  session.logs.push(`[${timestamp}] ${message}`);
  console.log(`[Automation ${session.reportId}] ${message}`);
}

export function getAllSessions(): AutomationSession[] {
  return Array.from(sessions.values());
}
