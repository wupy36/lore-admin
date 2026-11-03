// TanStack Query hooks over the API. Query keys are scoped by server and repo
// so switching selection never shows another repository's data.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Channel, Input, Output } from "@shared/api";
import { useUi } from "../store/ui";
import { api } from "./client";

export const keys = {
  info: ["info"] as const,
  servers: ["servers"] as const,
  status: (s: string) => ["status", s] as const,
  repos: (s: string) => ["repos", s] as const,
  branches: (s: string, r: string) => ["branches", s, r] as const,
  history: (s: string, r: string, b: string) => ["history", s, r, b] as const,
  revision: (s: string, r: string, h: string) => ["revision", s, r, h] as const,
  locks: (s: string, r: string, f: object) => ["locks", s, r, f] as const,
  audit: ["audit"] as const,
};

export const useInfo = () => useQuery({ queryKey: keys.info, queryFn: () => api.call("app:info"), staleTime: Infinity });
export const useServers = () => useQuery({ queryKey: keys.servers, queryFn: () => api.call("servers:list") });

export function useServerStatus(serverId: string | null) {
  return useQuery({ queryKey: keys.status(serverId ?? ""), queryFn: () => api.call("servers:status", { serverId: serverId as string }), enabled: !!serverId, refetchInterval: 60_000 });
}
export function useRepos(serverId: string | null) {
  return useQuery({ queryKey: keys.repos(serverId ?? ""), queryFn: () => api.call("repos:list", { serverId: serverId as string }), enabled: !!serverId });
}
export function useBranches(serverId: string | null, repo: string | null) {
  return useQuery({ queryKey: keys.branches(serverId ?? "", repo ?? ""), queryFn: () => api.call("branches:list", { serverId: serverId as string, repo: repo as string }), enabled: !!serverId && !!repo });
}
export function useHistory(serverId: string | null, repo: string | null, branch: string | null, length = 300) {
  return useQuery({ queryKey: keys.history(serverId ?? "", repo ?? "", branch ?? ""), queryFn: () => api.call("history:list", { serverId: serverId as string, repo: repo as string, branch: branch as string, length }), enabled: !!serverId && !!repo && !!branch });
}
export function useRevision(serverId: string | null, repo: string | null, hash: string | null) {
  return useQuery({ queryKey: keys.revision(serverId ?? "", repo ?? "", hash ?? ""), queryFn: () => api.call("history:detail", { serverId: serverId as string, repo: repo as string, revision: hash as string }), enabled: !!serverId && !!repo && !!hash, staleTime: Infinity });
}
export function useLocks(serverId: string | null, repo: string | null, f: { branch?: string; owner?: string; path?: string }) {
  return useQuery({ queryKey: keys.locks(serverId ?? "", repo ?? "", f), queryFn: () => api.call("locks:list", { serverId: serverId as string, repo: repo as string, ...f }), enabled: !!serverId && !!repo });
}
export function useAudit(mutatingOnly: boolean) {
  return useQuery({ queryKey: [...keys.audit, mutatingOnly], queryFn: () => api.call("audit:list", { limit: 1000, mutatingOnly }) });
}

/** Mutation that invalidates the given key prefixes and reports errors to the status bar. */
export function useCall<C extends Channel>(channel: C, invalidate: (input: Input<C>) => readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Input<C>) => (api.call as (c: C, i: Input<C>) => Promise<Output<C>>)(channel, input),
    onSuccess: (_v, input) => Promise.all(invalidate(input).map((k) => qc.invalidateQueries({ queryKey: k as unknown[] }))),
    onError: (e) => useUi.getState().setError(`${channel}: ${e instanceof Error ? e.message : String(e)}`),
  });
}

/** Live console + cross-client refresh over SSE. */
export function useEvents(enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    return api.events((ev) => {
      if (ev.type === "log") useUi.getState().pushLog(ev.entry);
      else if (ev.type === "servers:changed") void qc.invalidateQueries({ queryKey: keys.servers });
    });
  }, [enabled, qc]);
}
