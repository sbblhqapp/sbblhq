import { useState } from 'react';
import { Trash2, AlertTriangle, ShieldCheck, RefreshCw, CheckCircle2, Clock, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { previewArchivedMediaPurge, executeArchivedMediaPurge } from '@/lib/api/ops';

export type MediaArchivedPurgeModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function MediaArchivedPurgeModal({ isOpen, onClose }: MediaArchivedPurgeModalProps) {
  const queryClient = useQueryClient();
  const [retentionDays, setRetentionDays] = useState(30);

  const previewQuery = useQuery({
    queryKey: ['ops-archived-media-purge-preview', retentionDays],
    queryFn: () => previewArchivedMediaPurge(retentionDays),
    enabled: isOpen,
  });

  const purgeMutation = useMutation({
    mutationFn: () => executeArchivedMediaPurge(retentionDays),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-media-publications'] });
      queryClient.invalidateQueries({ queryKey: ['ops-archived-media-purge-preview'] });
    },
  });

  if (!isOpen) return null;

  const data = previewQuery.data;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="purge-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto animate-in fade-in"
    >
      <div className="bg-[#121212] border border-[#2A2A2A] rounded-xl max-w-2xl w-full p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-2xl my-auto max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#222222] pb-3 sm:pb-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="p-2 sm:p-2.5 rounded-lg bg-[#E63946]/10 text-[#E63946] border border-[#E63946]/20 shrink-0">
              <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h3 id="purge-modal-title" className="text-sm sm:text-base font-bold text-[#F5F5F0] truncate">
                Autonomous 30-Day Archived Media Purge
              </h3>
              <p className="text-[11px] sm:text-xs text-[#8A8A8A] truncate">
                Permanent database and storage bucket deletion engine
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close purge modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xs text-[#8A8A8A] hover:text-[#F5F5F0] hover:bg-[#1E1E1E] active:scale-95 rounded-lg transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body - Scrollable on small screens */}
        <div className="space-y-4 overflow-y-auto flex-1 pr-0.5">
          {/* Policy Highlights */}
          <div className="bg-[#181818] p-3 sm:p-3.5 rounded-lg border border-[#262626] text-xs space-y-2">
            <div className="flex items-center gap-2 text-[#C9A84C] font-semibold">
              <ShieldCheck className="w-4 h-4 text-[#C9A84C] shrink-0" />
              <span>Autonomous Cloudflare Cron & Storage Purge Policy</span>
            </div>
            <p className="text-[#A1A1AA] text-[11px] sm:text-xs leading-relaxed">
              The system autonomously triggers a daily maintenance cron at <strong className="text-[#F5F5F0]">03:00 UTC</strong>. Any media archived for <strong className="text-[#F5F5F0]">&gt; {retentionDays} days</strong> without being reposted or restored is permanently deleted from the PostgreSQL database and all Supabase Storage buckets (<code className="text-[#C9A84C]">media</code>, <code className="text-[#C9A84C]">league-media</code>).
            </p>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 pt-1 text-[11px] text-[#71717A]">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                Published/Draft: Immune
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                Reposted/Restored: Timer Cancelled
              </span>
            </div>
          </div>

          {/* Purge Stats Preview */}
          {previewQuery.isLoading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-[#8A8A8A]">
              <RefreshCw className="w-5 h-5 animate-spin text-[#C9A84C]" />
              <span>Scanning archived media and physical storage buckets…</span>
            </div>
          ) : previewQuery.isError ? (
            <div className="p-3 bg-red-950/40 border border-red-800/50 rounded-lg text-xs text-red-300">
              Failed to scan archived media: {(previewQuery.error as Error).message}
            </div>
          ) : data ? (
            <div className="space-y-3 sm:space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div className="bg-[#161616] p-3 rounded-lg border border-[#222222]">
                  <span className="text-[10px] sm:text-[11px] font-semibold text-[#8A8A8A] uppercase">
                    Expired Publications
                  </span>
                  <p className="text-lg sm:text-xl font-bold text-[#F5F5F0] mt-0.5 sm:mt-1">
                    {data.totalEligible}{' '}
                    <span className="text-xs font-normal text-[#8A8A8A]">items</span>
                  </p>
                </div>
                <div className="bg-[#161616] p-3 rounded-lg border border-[#222222]">
                  <span className="text-[10px] sm:text-[11px] font-semibold text-[#8A8A8A] uppercase">
                    Storage Files to Delete
                  </span>
                  <p className="text-lg sm:text-xl font-bold text-[#E63946] mt-0.5 sm:mt-1">
                    {data.totalStorageFiles}{' '}
                    <span className="text-xs font-normal text-[#8A8A8A]">files</span>
                  </p>
                </div>
              </div>

              {/* List of eligible items */}
              {data.totalEligible > 0 ? (
                <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg border border-[#222222] bg-[#141414] p-2">
                  {data.publications.map((pub) => (
                    <div
                      key={pub.id}
                      className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-[#1A1A1A] border border-[#262626] gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[#F5F5F0] truncate">{pub.title}</p>
                        <p className="text-[10px] sm:text-[11px] text-[#8A8A8A] truncate">
                          {pub.surface} • {pub.daysArchived}d archived ({pub.storagePaths.length} files)
                        </p>
                      </div>
                      <span className="text-[10px] font-bold text-[#E63946] bg-[#E63946]/10 px-2 py-1 rounded shrink-0">
                        Expired
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-lg border border-[#222222] bg-[#141414] text-center text-xs text-[#8A8A8A]">
                  ✓ All archived media is within the {retentionDays}-day retention grace period. No items currently pending deletion.
                </div>
              )}
            </div>
          ) : null}

          {purgeMutation.isSuccess && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-lg text-xs text-emerald-300 animate-in fade-in flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Successfully purged {purgeMutation.data?.purgedPublications} expired publications and {purgeMutation.data?.storageFilesRemoved} storage objects.
              </span>
            </div>
          )}
        </div>

        {/* Action Controls - Mobile-friendly layout */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-[#222222] pt-3 sm:pt-4 gap-3 shrink-0">
          <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
            <label htmlFor="retention-select" className="text-xs text-[#8A8A8A] shrink-0">
              Retention Window:
            </label>
            <select
              id="retention-select"
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
              className="min-h-[44px] bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-xs text-[#F5F5F0] focus:border-[#C9A84C] focus:outline-none flex-1 sm:flex-initial"
            >
              <option value={30}>30 Days (Production Default)</option>
              <option value={14}>14 Days</option>
              <option value={60}>60 Days</option>
              <option value={90}>90 Days</option>
            </select>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] flex-1 sm:flex-initial px-4 py-2 text-xs font-semibold text-[#8A8A8A] hover:text-[#F5F5F0] hover:bg-[#1E1E1E] rounded-lg bg-[#1A1A1A] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={purgeMutation.isPending || !data || data.totalEligible === 0}
              onClick={() => purgeMutation.mutate()}
              className="min-h-[44px] flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-5 py-2 text-xs font-bold bg-[#E63946] text-white rounded-lg hover:bg-[#D62828] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md"
            >
              {purgeMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                  <span>Purging…</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 shrink-0" />
                  <span>Purge {data?.totalEligible ?? 0} Expired</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
