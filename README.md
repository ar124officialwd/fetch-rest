# Fetch REST

`fetch` with some _REST_.

#### What it is?
A convenient wrapper around the `fetch` API that provides type safety, class-based configuration, retry support, JWT token handling, and hooks for request lifecycle. It is mainly intended for SPA's for quick and safe API integration.

#### What is not?
A full fledged HTTP client library with advanced features like caching, and more - so not `axios` or alike.

#### What it aims at
Being a minimal wrapper for type-safe http requests with some common handlings like 401, 429, and caching - which you find yourself in writing boilerplate codes in SPA.

## Installation
```sh
npm install fetrest
```
_OR_
```sh
yarn add fetrest
```
_OR_
```sh
pnpm add fetrest
```

## Features (Current)
- ✅ Typed (Basic yet): Yes, your request body and request response are type safe.
- ✅ Class based: Since it is a class, you get an instance with some configuration and use it without specifying config again and again.
- ✅ Convinient Methods: Includes `.get`, `.post`, `.patch`, `.put`, `.delete` and `.head`.
- ✅ Retries: Support retries, constrained by status codes to retry on - and number of retries - and retry delay
- ✅ JWT Token: Supports attaching / replacing JWT Token
- ✅ 401 Handler: Whenever a request fails with a 401 status code, it will automatically call specified handler and if success, retry the request with the JWT token attached.
- ✅ Hooks (Basic yet): Support hooks for request lifecycle

## Usage:
[Try it yourself](https://stackblitz.com/edit/stackblitz-starters-nht4hnmr?file=index.js)

Following a quick and basic example to see how it works:
```typescript
import { FetchRestSingleton } from 'fetrest';

// create
const api = FetchRestSingleton.getInstance({
  baseUrl: 'https://api.example.com',
});

// configure
api.setJwtToken(localStorage.getItem('token'))

api.set401Handler(() => {
  window.location.href = '/login'; // so whenever a request fails with a 401 status code - it takes user to login page. REST
})

api.set404Handler(() => {
  window.location.href = '/404';
})

// use
api.get<APIUser>('/users').then((response) => {
  console.log(response.data);
});
```

## API Docs

See full [API Docs](https://ar124officialwd.github.io/fetrest/index.html).

While it is a just a wrapper around the native `fetch` function, its API differs slightly from the native `fetch` function. See important details here.

### Fetch Options
Fetch options are the options you would usually pass to the native `fetch` function as 2nd argument. They include headers, body, method, etc.
`fetrest` seeds the `fetch` with options from 3 sources:
* `FetchRest` object (instance of `FetchRestSingleton` | `FetchRest`): You pass these options to constructor or `FetchRestSingleton.getInstance` method. These may be overridden by request method options and / or `FetchRest` own options.
```ts
const api = FetchRestSingleton.getInstance({
  baseURL: 'https://api.example.com',
  fetchOpts: { /* fetch options */ }
});
```
* Request Method call: You pass these options to request method (i.e. `.request`, `.get`, `.post`, `.put`...). These may be overridden by `FetchRest` own options.
```ts
api.get('/posts', { fetchOpts: { /* fetch options */ } });
```
* FetchRest own options. They're never overridden.


So it is important to understand the precedence of these options. Here is how different options are set:

#### `method`
It is always set directly by `FetchRest`, based on Request Method you pass to `.request` or if you use convinience methods (`.get` etc).
#### `headers`
They're merged from instance options, request call options and fetch rest options.
##### `headers.AUTHORIZATION`
If you set JWT token, by using `.setJwtToken` method, it will be set as `Authorization` header. Otherwise, it may or may not be present depending on whether it is present in instance options or request call options.
##### `headers.CONTENT_TYPE`
It is set directly by `FetchRest`, based on Request Method and Request Body (Payload).

#### `body`
It is set directly by `FetchRest`, based on Request Method and Request Body (Payload).

## Roadmap
- [ ] Full Typed: Support full type safety for request body and response body
- [ ] `fetch` override: Override the `fetch` function to do some mocking / testing
- [ ] Hooks: Provide more robust hooks support
- [ ] Debounce: Debounce requests to prevent unnecessary network calls
- [ ] Support `429` handling
- [ ] Caching: Support caching of responses
