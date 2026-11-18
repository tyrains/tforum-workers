/**
 * 流程控制异常：对应 PHP 版靠 exit/header 提前结束请求的写法。
 * - ApiError：对应 core.php 的 err()，抛出后由入口统一输出 {ok:false,error} JSON。
 * - RedirectExit：对应 core.php 的 redirect() / header('Location: ...')，抛出后由入口统一发 302。
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class RedirectExit extends Error {
  constructor(
    public location: string,
    public status: number = 302,
  ) {
    super('redirect: ' + location);
  }
}

/** 对应 core.php 的 ok()/json_out()：携带最终 JSON 响应体提前结束请求。 */
export class JsonExit extends Error {
  constructor(
    public payload: Record<string, unknown>,
    public status: number = 200,
  ) {
    super('json response');
  }
}
