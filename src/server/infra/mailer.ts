import { getEnv } from "@/server/env";
import { logger } from "./logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailAdapter {
  send(message: MailMessage): Promise<void>;
}

class ConsoleMailAdapter implements MailAdapter {
  async send(message: MailMessage): Promise<void> {
    logger.info("dev mail dispatched", {
      from: getEnv().MAIL_FROM,
      to: message.to,
      subject: message.subject,
      preview: message.text,
    });
  }
}

export const mailer: MailAdapter = new ConsoleMailAdapter();
