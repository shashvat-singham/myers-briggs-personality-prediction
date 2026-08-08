"use client";

import {
  get,
  limitToLast,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
} from "firebase/database";
import { getDb } from "./firebase";
import type { TestResult } from "./types";

const LOCAL_KEY = "mbti:pending-result";

/* ---------------------------------------------------------------- local ---
 * A result taken while signed out lives in localStorage so the user can read
 * it immediately. `adoptPendingResult` moves it into the database on sign-in,
 * which is why the local copy keeps the exact same shape.
 * ------------------------------------------------------------------------ */

export function savePendingResult(result: Omit<TestResult, "id">): TestResult {
  const stored: TestResult = { ...result, id: "local" };
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(stored));
  } catch {
    // Private-browsing quota errors are not worth failing the test over.
  }
  return stored;
}

export function readPendingResult(): TestResult | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as TestResult) : null;
  } catch {
    return null;
  }
}

export function clearPendingResult() {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------- database ---
 * Layout:
 *   users/{uid}/results/{pushKey}   one completed test
 *
 * Push keys embed their creation time and sort lexicographically, so
 * `orderByKey().limitToLast(n)` is exactly "the n most recent" with no index
 * and no extra field. RTDB cannot sort descending, so the slice is reversed
 * here rather than in the query.
 * ------------------------------------------------------------------------ */

function resultsRef(uid: string) {
  const db = getDb();
  if (!db) throw new Error("Firebase is not configured.");
  return ref(db, `users/${uid}/results`);
}

export async function saveResult(uid: string, result: Omit<TestResult, "id">): Promise<string> {
  const node = push(resultsRef(uid));
  await set(node, {
    type: result.type,
    axes: result.axes,
    tally: result.tally,
    answers: result.answers,
    durationMs: result.durationMs,
    createdAt: result.createdAt,
    // Authoritative clock, kept alongside the device clock the UI optimistically
    // rendered with. Sorting and display both use `createdAt`; this exists so a
    // skewed device clock is detectable rather than silently wrong.
    serverCreatedAt: serverTimestamp(),
  });
  if (!node.key) throw new Error("Firebase did not return a key for the saved result.");
  return node.key;
}

export async function listResults(uid: string, max = 50): Promise<TestResult[]> {
  const snap = await get(query(resultsRef(uid), limitToLast(max)));
  if (!snap.exists()) return [];
  const rows: TestResult[] = [];
  snap.forEach((child) => {
    rows.push({ id: child.key as string, ...(child.val() as Omit<TestResult, "id">) });
  });
  return rows.reverse();
}

export async function getResult(uid: string, id: string): Promise<TestResult | null> {
  const db = getDb();
  if (!db) throw new Error("Firebase is not configured.");
  const snap = await get(ref(db, `users/${uid}/results/${id}`));
  if (!snap.exists()) return null;
  return { id, ...(snap.val() as Omit<TestResult, "id">) };
}

export async function deleteResult(uid: string, id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Firebase is not configured.");
  await remove(ref(db, `users/${uid}/results/${id}`));
}

/**
 * Move a signed-out result into the user's account. Returns the new id, or
 * null when there was nothing pending.
 */
export async function adoptPendingResult(uid: string): Promise<string | null> {
  const pending = readPendingResult();
  if (!pending) return null;
  const { id: _ignored, ...rest } = pending;
  void _ignored;
  const id = await saveResult(uid, rest);
  clearPendingResult();
  return id;
}
