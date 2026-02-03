import type { RequestClient } from "@buape/carbon";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import type { ChunkMode } from "../../auto-reply/chunk.js";
import type { ReplyPayload } from "../../auto-reply/types.js";
import type { MarkdownTableMode } from "../../config/types.base.js";
import type { RuntimeEnv } from "../../runtime.js";
import { convertMarkdownTables } from "../../markdown/tables.js";
import { chunkDiscordTextWithMode } from "../chunk.js";
import { sendMessageDiscord } from "../send.js";

const DISCORD_DEBUG_LOG = path.join(os.homedir(), ".openclaw", "discord-delivery-debug.log");
function discordDeliveryLog(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${message}\n`;
  fs.appendFile(DISCORD_DEBUG_LOG, logMessage).catch(() => {});
}

export async function deliverDiscordReply(params: {
  replies: ReplyPayload[];
  target: string;
  token: string;
  accountId?: string;
  rest?: RequestClient;
  runtime: RuntimeEnv;
  textLimit: number;
  maxLinesPerMessage?: number;
  replyToId?: string;
  tableMode?: MarkdownTableMode;
  chunkMode?: ChunkMode;
}) {
  discordDeliveryLog(`DELIVERY START: ${params.replies?.length || 0} replies to deliver, target=${params.target}`);
  const chunkLimit = Math.min(params.textLimit, 2000);
  for (const payload of params.replies) {
    const mediaList = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
    const rawText = payload.text ?? "";
    const tableMode = params.tableMode ?? "code";
    const text = convertMarkdownTables(rawText, tableMode);
    discordDeliveryLog(`Processing reply: rawText length=${rawText.length}, text length=${text.length}, mediaList=${mediaList.length}, first 100 chars: ${text.substring(0, 100)}`);
    if (!text && mediaList.length === 0) {
      discordDeliveryLog(`SKIPPED: Empty text and no media`);
      continue;
    }
    const replyTo = params.replyToId?.trim() || undefined;

    if (mediaList.length === 0) {
      let isFirstChunk = true;
      const mode = params.chunkMode ?? "length";
      const chunks = chunkDiscordTextWithMode(text, {
        maxChars: chunkLimit,
        maxLines: params.maxLinesPerMessage,
        chunkMode: mode,
      });
      if (!chunks.length && text) {
        chunks.push(text);
      }
      for (const chunk of chunks) {
        const trimmed = chunk.trim();
        if (!trimmed) {
          continue;
        }
        try {
          await sendMessageDiscord(params.target, trimmed, {
            token: params.token,
            rest: params.rest,
            accountId: params.accountId,
            replyTo: isFirstChunk ? replyTo : undefined,
          });
          discordDeliveryLog(`SENT CHUNK: ${trimmed.length} chars, isFirst=${isFirstChunk}`);
          isFirstChunk = false;
        } catch (err) {
          discordDeliveryLog(`SEND FAILED: ${(err as Error)?.message || String(err)}`);
          throw err;
        }
      }
      continue;
    }

    const firstMedia = mediaList[0];
    if (!firstMedia) {
      continue;
    }
    await sendMessageDiscord(params.target, text, {
      token: params.token,
      rest: params.rest,
      mediaUrl: firstMedia,
      accountId: params.accountId,
      replyTo,
    });
    for (const extra of mediaList.slice(1)) {
      await sendMessageDiscord(params.target, "", {
        token: params.token,
        rest: params.rest,
        mediaUrl: extra,
        accountId: params.accountId,
      });
    }
  }
}
