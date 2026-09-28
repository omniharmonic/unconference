export interface TelegramBot {
  event_id: string; id: string; bot_id: string; username: string; token_ciphertext: Uint8Array
  webhook_secret_hash: string; ready: boolean; chat_id: string | null; chat_title: string | null
  chat_type: 'group' | 'supergroup' | 'channel' | null; thread_id: number | null
  pending_chat: { id: string; title: string; type: string; thread_id: number | null } | null
  pairing_hash: string | null; pairing_expires_at: string | null
  announcements: boolean; announcements_since: string | null; ask_enabled: boolean
  group_answers: boolean; daily_limit: number
}
export interface TelegramMessage {
  message_id: number; date: number; text?: string; message_thread_id?: number
  chat: { id: number; type: string; title?: string }
  from?: { id: number; is_bot?: boolean }
  entities?: Array<{ type: string; offset: number; length: number }>
  reply_to_message?: { from?: { id: number; is_bot?: boolean } }
}
export interface TelegramUpdate { update_id: number; message?: TelegramMessage; channel_post?: TelegramMessage }
export interface TelegramJob {
  id: string; event_id: string; connection_id: string; kind: 'announcement' | 'retract' | 'question' | 'notice'
  chat_id: string; thread_id: number | null; reply_to: number | null; telegram_user_id: string | null
  source_chat_id: string | null; source_thread_id: number | null; parent_id: string | null
  account_id: string | null; feed_post_id: string | null; question_ciphertext: Uint8Array | null
  response_ciphertext: Uint8Array | null; attempts: number; message_id: number | null
}
