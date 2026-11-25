import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { createMediaRefCache, mediaRef } from "../lib/media-refs";
import { onOpenCodeConnectionRetired, openCodeClient } from "../services/opencode-client";

type MediaRefCache = ReturnType<typeof createMediaRefCache>;
let cache: MediaRefCache | undefined;

/**
 * The shared cache, created on first use so importing this hook has no side effects. Reads go
 * through the connection's own client, so SSH and paired HTTP servers work and the connection's
 * credentials are attached by the main process.
 */
function mediaRefs(): MediaRefCache {
  if (cache) return cache;
  const created = createMediaRefCache({
    read: (connectionID, hash) => openCodeClient(connectionID).experimental.media.get({ hash }),
  });
  onOpenCodeConnectionRetired((connectionID) => created.disposeConnection(connectionID));
  cache = created;
  return created;
}

export interface MediaSource {
  /** What to render: the value itself when it is not a reference, or the resolved object URL. */
  url: string | null;
  failed: boolean;
}

/**
 * Resolves a `media:<hash>` reference from a message read to an object URL through the
 * focused connection, or the given connection. Any other value passes through unchanged.
 */
export function useMediaSource(
  value: string | null | undefined,
  mime: string,
  connectionID?: string,
): MediaSource {
  const focused = useAtomValue(runtimeAtom)?.connectionID;
  const owner = connectionID ?? focused;
  const ref = mediaRef(value);
  const cached = ref && owner ? mediaRefs().peek(owner, ref) : undefined;
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean } | null>(
    null,
  );
  const key = ref && owner ? `${owner}\u0000${ref}` : null;

  useEffect(() => {
    if (!ref || !owner || !key) return;
    let active = true;
    const lease = mediaRefs().acquire(owner, ref, mime);
    lease.url.then(
      (url) => {
        if (active) setState({ key, url, failed: false });
      },
      () => {
        if (active) setState({ key, url: null, failed: true });
      },
    );
    return () => {
      active = false;
      lease.release();
    };
  }, [key, mime, owner, ref]);

  if (!ref) return { url: value ?? null, failed: false };
  if (!owner) return { url: null, failed: true };
  if (state?.key === key) return { url: state.url, failed: state.failed };
  return { url: cached ?? null, failed: false };
}
