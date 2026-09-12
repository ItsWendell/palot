import type { CnFunction } from "cn";
import { createCn } from "cn/config";

export const cn: CnFunction = createCn({
  extend: {
    theme: {
      text: [
        "compact",
        "meta",
        "micro",
        "tag",
        "page-title",
        "hero",
        "code",
        "code-compact",
        "diff",
        "tree",
      ],
    },
  },
});
