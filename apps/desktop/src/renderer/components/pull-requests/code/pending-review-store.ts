import { atom, useAtom, type PrimitiveAtom } from "jotai";
import { useCallback } from "react";
import type { PullRequestKey } from "../../../../shared/source-control-contract";
import type { PendingReviewComment } from "./pull-request-code-model";

/** A review being written: its summary and the line comments it will carry. */
export interface PendingReview {
  body: string;
  comments: PendingReviewComment[];
}

const EMPTY_REVIEW: PendingReview = { body: "", comments: [] };
const reviews = new Map<PullRequestKey, PrimitiveAtom<PendingReview>>();

/**
 * In-memory pending review for one pull request. Kept per PR key so switching tabs or pull
 * requests does not lose comments; never persisted, since GitHub anchors them to one head.
 */
export function pendingReviewAtom(key: PullRequestKey): PrimitiveAtom<PendingReview> {
  let value = reviews.get(key);
  if (!value) {
    value = atom(EMPTY_REVIEW);
    reviews.set(key, value);
  }
  return value;
}

export function usePendingReview(key: PullRequestKey) {
  const [review, setReview] = useAtom(pendingReviewAtom(key));
  const addComment = useCallback(
    (comment: Omit<PendingReviewComment, "id">) =>
      setReview((current) => ({
        ...current,
        comments: [...current.comments, { ...comment, id: crypto.randomUUID() }],
      })),
    [setReview],
  );
  const updateComment = useCallback(
    (id: string, body: string) =>
      setReview((current) => ({
        ...current,
        comments: current.comments.map((comment) =>
          comment.id === id ? { ...comment, body } : comment,
        ),
      })),
    [setReview],
  );
  const removeComment = useCallback(
    (id: string) =>
      setReview((current) => ({
        ...current,
        comments: current.comments.filter((comment) => comment.id !== id),
      })),
    [setReview],
  );
  const setBody = useCallback(
    (body: string) => setReview((current) => ({ ...current, body })),
    [setReview],
  );
  /**
   * After a successful submit: drop what was sent, keeping anything added or rewritten while
   * the request was in flight.
   */
  const settleSubmitted = useCallback(
    (submitted: { body: string; commentIDs: readonly string[] }) =>
      setReview((current) => {
        const sent = new Set(submitted.commentIDs);
        return {
          body: current.body === submitted.body ? "" : current.body,
          comments: current.comments.filter((comment) => !sent.has(comment.id)),
        };
      }),
    [setReview],
  );
  return { review, addComment, updateComment, removeComment, setBody, settleSubmitted };
}

export type PendingReviewController = ReturnType<typeof usePendingReview>;
