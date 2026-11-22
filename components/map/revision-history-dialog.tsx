"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { AlertCircle, Clock, History, Loader2, RotateCcw, X } from "lucide-react";
import type { LearningMap } from "@/types/map";
import type { MapDiffSummary, MapSnapshotDetail, MapSnapshotSummary } from "@/types/history";
import {
  computeMapDiff,
  getMapRevisionDetail,
  listMapRevisions,
  restoreMapRevision,
} from "@/lib/maps/history";

interface RevisionHistoryDialogProps {
  map: LearningMap;
  currentRevision: number;
  isOpen: boolean;
  onClose: () => void;
  onRestored: (newMap: LearningMap, newRevision: number) => void;
}

export function RevisionHistoryDialog({
  map,
  currentRevision,
  isOpen,
  onClose,
  onRestored,
}: RevisionHistoryDialogProps) {
  const [revisions, setRevisions] = useState<MapSnapshotSummary[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<MapSnapshotDetail | null>(null);
  const [diff, setDiff] = useState<MapDiffSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadDetail = useCallback(async (snapshotId: string) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const detail = await getMapRevisionDetail(map.id, snapshotId);
      if (detail && detail.snapshot) {
        setSelectedSnapshot(detail);
        setDiff(computeMapDiff(map, detail.snapshot));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load revision details");
    } finally {
      setLoadingDetail(false);
    }
  }, [map]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    listMapRevisions(map.id)
      .then(async (items) => {
        if (!isMounted) return;
        setRevisions(items);
        setLoading(false);
        if (items.length > 0) {
          const detail = await getMapRevisionDetail(map.id, items[0].id);
          if (isMounted && detail && detail.snapshot) {
            setSelectedSnapshot(detail);
            setDiff(computeMapDiff(map, detail.snapshot));
          }
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to load history");
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, map]);

  const handleRestore = () => {
    if (!selectedSnapshot) return;

    startTransition(async () => {
      setError(null);
      const res = await restoreMapRevision({
        mapId: map.id,
        snapshotId: selectedSnapshot.id,
        currentRevision,
        expectedRevision: currentRevision,
      });

      if (!res.success || !res.restoredMap) {
        setError(res.errorMessage ?? "Failed to restore map revision.");
        return;
      }

      onRestored(res.restoredMap, res.newRevision);
      onClose();
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-dialog-title"
    >
      <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="history-dialog-title" className="text-lg font-semibold text-foreground">
              Revision History
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close revision history"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div
            className="mt-4 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Content */}
        <div className="mt-4 grid min-h-[300px] flex-1 grid-cols-1 gap-6 overflow-hidden md:grid-cols-5">
          {/* Revisions list */}
          <div className="overflow-y-auto pr-2 md:col-span-2">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : revisions.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                No saved revisions found yet. Revisions are created each time you save.
              </p>
            ) : (
              <div className="space-y-2">
                {revisions.map((rev) => {
                  const isSelected = selectedSnapshot?.id === rev.id;
                  const dateStr = new Date(rev.savedAt).toLocaleString();
                  return (
                    <button
                      key={rev.id}
                      onClick={() => loadDetail(rev.id)}
                      className={`w-full rounded-xl border p-3 text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 shadow-xs"
                          : "border-border hover:bg-accent/50"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground">
                          Revision #{rev.revision}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                            rev.trigger === "restore"
                              ? "bg-amber-500/10 text-amber-500"
                              : "bg-blue-500/10 text-blue-500"
                          }`}
                        >
                          {rev.trigger}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{dateStr}</span>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {rev.nodeCount} nodes • {rev.edgeCount} connections
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Revision Preview & Diff */}
          <div className="flex flex-col justify-between rounded-xl border border-border bg-muted/20 p-4 md:col-span-3">
            {loadingDetail ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : selectedSnapshot ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {selectedSnapshot.title}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Saved on {new Date(selectedSnapshot.savedAt).toLocaleString()}
                  </p>
                </div>

                {diff && (
                  <div className="rounded-lg border border-border bg-card p-3">
                    <h4 className="text-xs font-semibold text-foreground">
                      Comparison with Current Map
                    </h4>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        Nodes added:{" "}
                        <span className="font-medium text-emerald-500">
                          +{diff.nodesAdded}
                        </span>
                      </div>
                      <div>
                        Nodes removed:{" "}
                        <span className="font-medium text-rose-500">
                          -{diff.nodesRemoved}
                        </span>
                      </div>
                      <div>
                        Nodes modified:{" "}
                        <span className="font-medium text-amber-500">
                          {diff.nodesModified}
                        </span>
                      </div>
                      <div>
                        Connections:{" "}
                        <span className="font-medium text-foreground">
                          +{diff.edgesAdded} / -{diff.edgesRemoved}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  Restoring will create a new current revision without losing existing history.
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Select a revision to view details and preview differences.
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRestore}
                disabled={!selectedSnapshot || isPending}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-xs transition hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Restore this Revision
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
