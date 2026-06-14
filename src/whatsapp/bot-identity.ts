import {
  areJidsSameUser,
  jidDecode,
  jidEncode,
  jidNormalizedUser,
  type Contact,
  type WASocket,
} from "baileys";

export type BotIdentity = {
  jids: string[];
  sources: Record<string, string | undefined>;
};

export type MentionMatch = {
  mentionedJid: string;
  botJid: string;
};

export function getBotIdentity(sock: WASocket): BotIdentity {
  const socketUser = sock.user;
  const authUser = sock.authState.creds.me;
  const sources = {
    "sock.user.id": socketUser?.id,
    "sock.user.lid": socketUser?.lid,
    "sock.user.phoneNumber": socketUser?.phoneNumber,
    "authState.creds.me.id": authUser?.id,
    "authState.creds.me.lid": authUser?.lid,
    "authState.creds.me.phoneNumber": authUser?.phoneNumber,
  };

  return {
    jids: uniqueJids([
      ...getContactJidVariants(socketUser),
      ...getContactJidVariants(authUser),
    ]),
    sources,
  };
}

export function findBotMentionMatch(
  mentionedJids: readonly string[],
  botJids: readonly string[],
): MentionMatch | undefined {
  for (const mentionedJid of mentionedJids) {
    for (const botJid of botJids) {
      if (jidsMatch(mentionedJid, botJid)) {
        return { mentionedJid, botJid };
      }
    }
  }

  return undefined;
}

export function getJidUser(jid: string): string | undefined {
  return jidDecode(jid)?.user;
}

function getContactJidVariants(contact: Contact | undefined): string[] {
  return [
    ...getJidVariants(contact?.id),
    ...getJidVariants(contact?.lid),
    ...getJidVariants(contact?.phoneNumber),
  ];
}

function getJidVariants(jid: string | undefined): string[] {
  if (!jid) return [];

  const decoded = jidDecode(jid);
  if (!decoded) return [jid];

  return [
    jid,
    jidNormalizedUser(jid),
    jidEncode(decoded.user, decoded.server),
  ];
}

function jidsMatch(left: string, right: string): boolean {
  return left === right || jidNormalizedUser(left) === jidNormalizedUser(right) || areJidsSameUser(left, right);
}

function uniqueJids(jids: string[]): string[] {
  return [...new Set(jids.filter(Boolean))];
}
