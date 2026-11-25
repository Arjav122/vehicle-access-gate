// The webcam device script keeps the rest of anpr/.env intact.
import { describe, expect, it } from "vitest";
import { upsertEnv } from "../prisma/webcamDevices.js";

describe("upsertEnv", () => {
  it("replaces existing keys and keeps every other line", () => {
    const before = "# my settings\nANPR_SAMPLE_FPS=8\nANPR_DEVICE_KEY=vd_old\n";
    expect(upsertEnv(before, { ANPR_DEVICE_KEY: "vd_new", ANPR_EXIT_DEVICE_KEY: "vd_exit" })).toBe(
      "# my settings\nANPR_SAMPLE_FPS=8\nANPR_DEVICE_KEY=vd_new\nANPR_EXIT_DEVICE_KEY=vd_exit\n",
    );
  });

  it("works on an empty or Windows-style file", () => {
    expect(upsertEnv("", { A: "1" })).toBe("A=1\n");
    expect(upsertEnv("X=1\r\nA=0\r\n", { A: "2" })).toBe("X=1\nA=2\n");
  });
});
