/** 生成过程中的流式事件：QQ 发送链路与后台模拟页共用。 */
export type StreamEvent =
  | { type: "delta"; text: string; delta: string; ttftMs?: number }
  | { type: "first-bubble"; text: string; atMs: number }
  | { type: "done"; reply: string }
  | { type: "stop"; reason: string };

export type StreamEventListener = (event: StreamEvent) => void;
