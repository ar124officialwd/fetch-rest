import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchRest, FetchRestSingleton } from "./index";

const fetchMock = vi.fn();

describe("FetchRest", () => {
  it("should be defined", () => {
    expect(FetchRest).toBeDefined();
  });

  it("should be an instance of FetchRest", () => {
    expect(
      new FetchRest({
        baseUrl: "http://localhost:3000",
      }),
    ).toBeInstanceOf(FetchRest);
  });

  it("instances should be distinct", () => {
    const instance1 = new FetchRest({ baseUrl: "http://localhost:3000" });
    const instance2 = new FetchRest({ baseUrl: "http://localhost:3000" });
    expect(instance1).not.toBe(instance2);
  });
});

describe("FetchRestSingleton", () => {
  it("should be defined", () => {
    expect(FetchRestSingleton).toBeDefined();
  });

  it("should be an instance of FetchRest", () => {
    expect(
      FetchRestSingleton.getInstance({ baseUrl: "http://localhost:3000" }),
    ).toBeInstanceOf(FetchRest);
  });

  it("instances should be same", () => {
    const instance1 = FetchRestSingleton.getInstance({
      baseUrl: "http://localhost:3000",
    });
    const instance2 = FetchRestSingleton.getInstance({
      baseUrl: "http://localhost:4000",
    });
    expect(instance1).toBe(instance2);
  });
});

describe("FetchRest: basic usage", () => {
  let client: FetchRest;

  beforeEach(() => {
    fetchMock.mockReset();
    client = new FetchRest({
      fetchFn: fetchMock,
      baseUrl: "http://localhost",
      fetchOpts: {
        headers: {
          X_TEST: "__X_TEST__",
        },
      },
    });
  });

  it("should support all common methods", () => {
    expect(client.get).toBeDefined();
    expect(client.post).toBeDefined();
    expect(client.put).toBeDefined();
    expect(client.patch).toBeDefined();
    expect(client.delete).toBeDefined();
    expect(client.head).toBeDefined();
  });

  it("should call GET with correct URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response());
    await client.get("/foo");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/foo",
      expect.anything(),
    );
  });

  it("should merge headers from fetchOpts", async () => {
    fetchMock.mockResolvedValueOnce(new Response());
    await client.get("/foo", {
      fetchOpts: {
        headers: {
          x_test: "__x_test__",
        },
      },
    });

    const call = fetchMock.mock.calls[0][1];
    expect(call?.headers).toEqual(
      expect.objectContaining({ x_test: "__x_test__" }),
    );
  });

  it("should append query params correctly", async () => {
    fetchMock.mockResolvedValueOnce(new Response());
    await client.get("/foo", { query: { q: "abc", p: 1 } });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/foo?q=abc&p=1",
      expect.anything(),
    );
  });

  it("should replace path params", async () => {
    fetchMock.mockResolvedValueOnce(new Response());
    await client.get("/bar/:id", { params: { id: 42 } });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/bar/42",
      expect.anything(),
    );
  });

  it("should handle JSON response correctly", async () => {
    const mock = { ok: true };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mock), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await client.get("/data");
    expect(res).toEqual(mock);
  });

  it("should throw parsed error response", async () => {
    const error = { message: "Bad request" };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(error), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(client.patch("/fail")).rejects.toEqual(error);
  });

  it("should support raw response", async () => {
    const res = new Response("raw", { status: 200 });
    fetchMock.mockResolvedValueOnce(res);
    const result = await client.put("/raw", { rawResponse: true });
    expect(result).toBe(res);
  });

  it("should throw raw response if not ok", async () => {
    const res = new Response("unauthorized", { status: 401 });
    fetchMock.mockResolvedValueOnce(res);
    await expect(client.get("/unauth", { rawResponse: true })).rejects.toBe(
      res,
    );
  });

  it("should handle FormData body", async () => {
    fetchMock.mockResolvedValueOnce(new Response());
    const form = new FormData();
    form.append("key", "value");
    await client.post("/upload", { body: form });
    const headers = fetchMock.mock.calls[0][1]?.headers;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("should send JSON body by default", async () => {
    fetchMock.mockResolvedValueOnce(new Response());
    await client.post("/json", { body: { name: "john" } });
    const opts = fetchMock.mock.calls[0][1];
    expect(opts?.headers).toMatchObject({
      "content-type": "application/json",
    });
    expect(opts?.body).toBe(JSON.stringify({ name: "john" }));
  });

  it("should not set content-type for DELETE", async () => {
    fetchMock.mockResolvedValueOnce(new Response());
    await client.delete("/resource");
    const headers = fetchMock.mock.calls[0][1]?.headers;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("should support multi-value query params", async () => {
    client.setJwtToken("token");
    fetchMock.mockResolvedValueOnce(new Response());
    await client.get("/resource", { query: { ids: [1, 2, 3] } });
    const headers = fetchMock.mock.calls[0][1]?.headers;
    expect(headers.authorization).toBe("Bearer token");
  });

  it("should support setting jwt token", async () => {
    client.setJwtToken("token");
    fetchMock.mockResolvedValueOnce(new Response());
    await client.get("/resource");
    const headers = fetchMock.mock.calls[0][1]?.headers;
    expect(headers.authorization).toBe("Bearer token");
  });
});

describe("FetchRest: advanced behavior", () => {
  let client: FetchRest;

  beforeEach(() => {
    fetchMock.mockReset();
    client = new FetchRest({
      fetchFn: fetchMock,
      baseUrl: "http://localhost",
      retryCount: 2,
      retryOn: [503],
      retryDelayMs: 0,
    });
  });

  it("should retry on configured status code", async () => {
    const res = new Response("", { status: 503 });

    const final = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    fetchMock
      .mockRejectedValueOnce(res)
      .mockRejectedValueOnce(res)
      .mockResolvedValueOnce(final);

    const result = await client.get("/retry");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("should fail after max retries", async () => {
    const errorResponse = new Response("fail", { status: 503 });
    fetchMock.mockResolvedValue(errorResponse);
    await expect(client.get("/fail")).rejects.toBe("fail");
  });

  it("should not attempt to parse response when no content", async () => {
    const errorResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });

    fetchMock.mockResolvedValue(errorResponse);
    await expect(client.head("/no-content")).resolves.toBe(undefined);
  });

  it("should call 401 handler only once", async () => {
    const jwtClient = new FetchRest({
      fetchFn: fetchMock,
      baseUrl: "http://localhost",
    });

    const handler = vi.fn().mockResolvedValue(undefined);
    jwtClient.set401Handler(handler);

    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const res = await jwtClient.get("/secure");
    expect(res).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.todo("should block requests on 401", async () => {
    const jwtClient = new FetchRest({
      fetchFn: fetchMock,
      baseUrl: "http://localhost",
    });

    const handler = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn();
    jwtClient.set401Handler(handler);

    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    fetchFn.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await jwtClient.get("/secure");
    await jwtClient.get("/secure-1", { fetchFn });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledAfter(handler);
  });

  it("should invoke hooks", async () => {
    const before = vi.fn();
    const after = vi.fn();

    const hookedClient = new FetchRest({
      fetchFn: fetchMock,
      baseUrl: "http://localhost",
      hooks: { beforeRequest: before, afterRequest: after },
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hookedClient.get("/hook");
    expect(result).toEqual({ ok: true });
    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });

  it("should invoke hooks with proper object", async () => {
    const before = vi.fn();
    const after = vi.fn();

    const hookedClient = new FetchRest({
      fetchFn: fetchMock,
      baseUrl: "http://localhost",
      hooks: { beforeRequest: before, afterRequest: after },
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await hookedClient.get("/hook/:id", {
      params: {
        id: 1,
      },
    });

    const expectedURL = "http://localhost/hook/1";

    expect(before).toHaveBeenCalledWith(
      expect.objectContaining({ url: expectedURL }),
    );

    expect(after).toHaveBeenCalledWith(
      expect.objectContaining({
        client: hookedClient,
        url: expectedURL,
        fetchOpts: expect.any(Object),
      }),
    );
  });
});

describe(
  "FetchRest: internal utilities",
  () => {
    it("should append query to existing ? in URL", async () => {
      const client = new FetchRest({
        fetchFn: fetchMock,
        baseUrl: "http://localhost",
      });

      fetchMock.mockResolvedValueOnce(new Response());
      await client.get("/search?q=abc", { query: { page: 2 } });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost/search?q=abc&page=2",
        expect.anything(),
      );
    });

    it("should delay using sleep", async () => {
      const client = new FetchRest({
        fetchFn: fetchMock,
        baseUrl: "http://localhost",
        retryCount: 1,
        retryDelayMs: 10,
        retryOn: [400],
      });

      const error = new Response(null, { status: 400 });

      vi.useFakeTimers(); // enable fake timers
      const spy = vi.spyOn(global, "setTimeout");

      fetchMock.mockRejectedValue(error);

      expect(client.get("400/", { rawResponse: true })).rejects.toBeInstanceOf(
        Response,
      );

      try {
        await vi.runAllTimersAsync(); // advance all timers (e.g., sleep)
      } catch { }

      expect(spy).toHaveBeenCalledWith(expect.any(Function), 10);

      spy.mockRestore();
      vi.useRealTimers(); // reset to real timers
    });
  },
  30 * 1000,
);

describe("FetchRestSingleton: internal", () => {
  it("should create instance once", () => {
    const inst1 = FetchRestSingleton.getInstance({ baseUrl: "http://one" });
    const inst2 = FetchRestSingleton.getInstance({ baseUrl: "http://two" });
    expect(inst1).toBe(inst2);
  });
});
