// Setup for the view project (vitest.config.ts). Vitest runs without globals, so Testing Library
// can't unmount between tests by itself.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
