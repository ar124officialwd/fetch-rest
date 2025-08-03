/**
 * Fetch like function
 */
export type FetchFn = typeof fetch;

/*
 * Available HTTP methods.
 */
export type FRHttpMethod = "HEAD" | "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type FRHookParam = {
  /**
   * Underlaying client being used
   */
  client: FetchRest;

  /**
   * The built URL - which is going to be hit (after adding path / query params)
   */
  url: string;

  /*
   * All fetch options - those will be passed to fetch function as 2nd param
   */
  fetchOpts: RequestInit;
};

/**
 * Hook function type.
 * All hooks must be of this type.
 */
export type FRHook = (arg: FRHookParam) => Promise<void>;

/**
 * Client options.
 */
export type FROptions = {
  /**
   * Override fetch function
   *
   * You can specify a fetch like function to be called, instead of `fetch` global function.
   *
   * Note: This will get overriden if specified {@link FRRequestOptions.fetchFn}.
   */
  fetchFn?: FetchFn;

  /**
   * default fetch options.
   *
   * Fetch options those will be passed to every request
   */
  fetchOpts?: RequestInit;

  /**
  /**
   * base url for the client
   */
  baseUrl: string;

  /**
   * number of retries in case of failure.
   *
   * This bounds to {@link FROptions.retryOn} - if `retryOn` is not specified (or empty array), it will not retry at all
   *
   * @default 0
   */
  retryCount?: number;

  /**
   * Status codes to follow for retries.
   * This bounds to {@link FROptions.retryCount} - if `retryCount` is not specified (or less than 1), it will not retry at all
   * @default []
   */
  retryOn?: number[];

  /**
   * Delay (in milliseconds) between each retry.
   * @default 1000 1-second
   */
  retryDelayMs?: number;

  /**
   * enable logging
   * @default false
   */
  logs?: boolean;

  /**
   * hooks for request lifecyle.
   *
   * NOTE: They're not interceptors - however user may use {@link FRHookParam.client} to do something intercepting like attaching a new token
   */
  hooks?: {
    beforeRequest?: FRHook;
    afterRequest?: FRHook;
  };
};

/**
 * Options for an indivdual request
 */
export type FRRequestOptions<TBody = unknown> = {
  /**
   * Override fetch function
   *
   * You can specify a fetch like function to be called, instead of `fetch` global function -- for this particular request.
   *
   * Note: This will override {@link FROptions.fetchFn} if specified both.
   */
  fetchFn?: FetchFn;

  /**
   * override fetch options for this request
   */
  fetchOpts?: RequestInit;

  /**
   * HTTP Path params
   */
  params?: Record<string, string | number>;

  /**
   * HTTP Query Params
   */
  query?: Record<
    string,
    string | string[] | number | number[] | boolean | undefined
  >;

  /**
   * HTTP Headers
   */
  headers?: Record<string, string>;

  /**
   * HTTP Body
   */
  body?: TBody;

  /**
   * Flag to return raw response instead of parsed / extracted body
   */
  rawResponse?: boolean;
};

/**
 * Type of Auth Handler function
 */
export type FRAuthFailureHandler = (response: Response) => Promise<void>;

/**
 * Fetch Rest - main class.
 * RECOMMENDATION: It is generally recommended to use {@link FetchRestSingleton} controls instead of `FetchRest`.
 */
export class FetchRest {
  protected fetchFn?: FetchFn;
  protected fetchOpts?: RequestInit;
  protected baseUrl: string;
  protected retryCount: number;
  protected retryDelayMs: number;
  protected retryOn: number[];
  protected logs: boolean;
  protected jwtToken: string | null = null;
  protected handle401: FRAuthFailureHandler | null = null;
  protected static ongoing401Handler: Promise<void> | null = null;

  protected hooks: {
    beforeRequest?: FRHook;
    afterRequest?: FRHook;
  };

  protected pendingRequests = new Map<
    string,
    { promise: Promise<unknown>; timestamp: number }
  >();

  constructor({
    fetchFn,
    fetchOpts,
    baseUrl,
    retryCount = 2,
    retryOn = [],
    retryDelayMs = 500,
    logs = false,
    hooks = {},
  }: FROptions) {
    this.fetchFn = fetchFn;
    this.fetchOpts = fetchOpts;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.retryCount = retryCount;
    this.retryDelayMs = retryDelayMs;
    this.retryOn = retryOn;
    this.logs = logs;
    this.hooks = hooks;
  }

  setJwtToken(token: string) {
    this.jwtToken = token;
  }

  set401Handler(handler: FRAuthFailureHandler) {
    this.handle401 = handler;
  }

  head = <TResponse = unknown>(
    path: string,
    options?: Omit<FRRequestOptions, "body">,
  ) => this.request<TResponse>(path, { ...options, method: "HEAD" });

  get = <TResponse = unknown>(
    path: string,
    options?: Omit<FRRequestOptions, "body">,
  ) => this.request<TResponse>(path, { ...options, method: "GET" });

  post = <TResponse = unknown, TBody = unknown>(
    path: string,
    options?: FRRequestOptions<TBody>,
  ) => this.request<TResponse, TBody>(path, { ...options, method: "POST" });

  put = <TResponse = unknown, TBody = unknown>(
    path: string,
    options?: FRRequestOptions<TBody>,
  ) => this.request<TResponse, TBody>(path, { ...options, method: "PUT" });

  patch = <TResponse = unknown, TBody = unknown>(
    path: string,
    options?: FRRequestOptions<TBody>,
  ) => this.request<TResponse, TBody>(path, { ...options, method: "PATCH" });

  delete = <TResponse = unknown>(
    path: string,
    options?: Omit<FRRequestOptions, "body">,
  ) => this.request<TResponse>(path, { ...options, method: "DELETE" });

  protected log(...args: unknown[]) {
    if (this.logs) console.log("[FetchRest]", ...args);
  }

  async request<TResponse = unknown, TBody = unknown>(
    path: string,
    options: FRRequestOptions<TBody> & { method?: FRHttpMethod } = {},
  ): Promise<TResponse> {
    const { method = "GET", params, query, headers = {}, body } = options;

    const url = this.buildUrl(path, params, query);
    const key = this.buildRequestKey(url, method, body);
    const now = Date.now();

    const promise = (async () => {
      let attempts = 0;
      let lastError: unknown;
      let handled401 = false;

      const makeRequest = async (): Promise<Response> => {
        const reqHeaders: Record<string, string> = this.buildHeaders(options);
        const fetchFn = this.fetchFn || options.fetchFn || fetch;

        const fetchOpts = {
          ...this.fetchOpts,
          ...options.fetchOpts,
          method,
          headers: reqHeaders,
          body: body
            ? body instanceof FormData
              ? body
              : JSON.stringify(body)
            : undefined,
        };

        if (this.hooks.beforeRequest) {
          await this.hooks.beforeRequest({
            client: this,
            url: url,
            fetchOpts,
          });
        }

        this.log("Sending request:", { url, method, headers, body });
        const response = await fetchFn(url, fetchOpts);

        if (this.hooks.afterRequest) {
          await this.hooks.afterRequest({
            client: this,
            url: url,
            fetchOpts,
          });
        }

        return response;
      };

      while (attempts <= this.retryCount) {
        try {
          if (FetchRest.ongoing401Handler) {
            this.log("Awaiting ongoing 401 handler...");
            await FetchRest.ongoing401Handler;
          }

          const response = await makeRequest();

          if (response.status === 401 && this.handle401 && !handled401) {
            handled401 = true;

            if (!FetchRest.ongoing401Handler) {
              this.log("Triggering 401 handler...");
              FetchRest.ongoing401Handler = (async () => {
                try {
                  if (this.handle401) await this.handle401(response);
                  this.log("401 handler complete");
                } finally {
                  FetchRest.ongoing401Handler = null;
                }
              })();
            }

            await FetchRest.ongoing401Handler;
            continue;
          }

          if (!response.ok) {
            this.log(`HTTP ${response.status} received`);
            if (
              this.retryOn.includes(response.status) &&
              attempts < this.retryCount
            ) {
              attempts++;
              this.log(`Retrying (${attempts}/${this.retryCount}) after delay`);
              await this.sleep(this.retryDelayMs * attempts);
              continue;
            }
          }

          const noContent =
            response.status === 204 ||
            response.status === 205 ||
            method === "HEAD";

          const shouldThrow = !response.ok;
          let resp = undefined as TResponse;

          if (noContent) {
            this.log("No content response");
          } else {
            if (options.rawResponse) {
              this.log("Response OK (raw)");
              resp = response as unknown as TResponse;
            } else {
              const contentType = response.headers.get("content-type") || "";
              const isJson = /application\/(json|\w+\+json)/.test(contentType);

              const parsed = isJson
                ? await response.json()
                : await response.text();
              this.log("Response OK", parsed);

              resp = parsed as TResponse;
            }
          }

          if (shouldThrow) throw resp;
          return resp;
        } catch (error) {
          lastError = error;
          const err = error as Response;

          this.log("Request error:", err.status ?? error);

          if (
            ++attempts > this.retryCount ||
            !this.retryOn.includes(err.status)
          )
            break;

          await this.sleep(this.retryDelayMs * attempts);
        }
      }

      throw lastError;
    })();

    this.pendingRequests.set(key, { promise, timestamp: now });

    promise
      .catch((err) => {
        this.log("Request failed:", err);
      })
      .finally(() => {
        const stored = this.pendingRequests.get(key);
        if (stored?.promise === promise) {
          this.pendingRequests.delete(key);
        }
      });

    return promise;
  }

  protected buildRequestKey(
    url: string,
    method: string,
    body?: unknown,
  ): string {
    return JSON.stringify({ url, method, body });
  }

  protected buildHeaders(opts?: FRRequestOptions & { method?: FRHttpMethod }) {
    const result = new Headers(this.fetchOpts?.headers);

    new Headers(opts?.fetchOpts?.headers).forEach((value, key) => {
      result.set(key, value);
    });

    if (this.jwtToken) {
      result.set("Authorization", `Bearer ${this.jwtToken}`);
    }

    if (
      ["POST", "PUT", "PATCH"].includes(opts?.method?.toUpperCase() || "") &&
      !(opts?.body instanceof FormData)
    ) {
      result.set("Content-Type", "application/json");
    }

    return Object.fromEntries(result.entries());
  }

  protected buildUrl(
    path: string,
    params?: Record<string, string | number>,
    query?: Record<
      string,
      string | string[] | number | number[] | boolean | undefined
    >,
  ): string {
    const isAbsoluteUrl = /^https?:\/\//i.test(path);
    let fullPath = path;

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        fullPath = fullPath.replace(
          new RegExp(`:${key}\\b`, "g"),
          encodeURIComponent(String(value)),
        );
      }
    }

    const queryString = query
      ? Object.entries(query)
          .filter(([, v]) => v)
          .flatMap(([k, v]) =>
            Array.isArray(v)
              ? v.map(
                  (item) =>
                    `${encodeURIComponent(k)}=${encodeURIComponent(String(item))}`,
                )
              : [`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`],
          )
          .join("&")
      : "";

    const separator = fullPath.includes("?") ? "&" : "?";

    return `${!isAbsoluteUrl ? this.baseUrl : ""}${fullPath}${
      queryString ? separator + queryString : ""
    }`;
  }

  protected async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Singleton class for making HTTP requests using the Fetch API.
 * RECOMMENDATION: It is recommmeded to use this class instead of base {@link FetchRest} for most of the uses
 */
export class FetchRestSingleton extends FetchRest {
  /**
   * Singleton instance of FetchRestSingleton.
   */
  protected static instance: FetchRestSingleton;

  protected constructor(opts: FROptions) {
    super(opts);
  }

  /**
   * Get the singleton instance of FetchRestSingleton.
   */
  static getInstance(opts: FROptions): FetchRestSingleton {
    if (!FetchRestSingleton.instance) {
      FetchRestSingleton.instance = new FetchRestSingleton(opts);
    }

    return FetchRestSingleton.instance;
  }
}
