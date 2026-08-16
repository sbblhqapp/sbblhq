import { ImageIcon, Save, Loader2, Upload, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { MediaFilterBar } from './MediaFilterBar';
import { MediaCard } from './MediaCard';
import { MediaDragCard } from './MediaDragCard';
import { MediaSortableList } from './MediaSortableList';
import { MediaSearchBar } from './MediaSearchBar';
import { MediaBulkActionBar } from './MediaBulkActionBar';
import { ArchiveModal } from './ArchiveModal';
import { MediaMetadataSheet } from './MediaMetadataSheet';
import { MediaPreviewSheet } from './MediaPreviewSheet';
import { MediaStaleCleanupDialog } from './MediaStaleCleanupDialog';
import { MediaArchivedPurgeModal } from './MediaArchivedPurgeModal';
import { MediaUploadFlow } from './MediaUploadFlow';
import { useOpsMediaLibrary } from '@/hooks/useOpsMediaLibrary';
import { restoreMediaPublication } from '@/lib/api/ops';

export type MediaLibraryTabProps = {
  enabled: boolean;
};

export function MediaLibraryTab({ enabled }: MediaLibraryTabProps) {
  const lib = useOpsMediaLibrary(enabled);
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);

  // ⚡ Bolt Performance Optimization: Memoize publication lookups to prevent O(N) array .find() on every render
  const previewPublication = useMemo(() =>
    lib.previewId ? lib.orderedMediaPublications.find((p) => p.id === lib.previewId) : undefined
  , [lib.orderedMediaPublications, lib.previewId]);

  const editPublication = useMemo(() =>
    lib.editId ? lib.orderedMediaPublications.find((p) => p.id === lib.editId) : undefined
  , [lib.orderedMediaPublications, lib.editId]);

  const archivePublication = useMemo(() =>
    lib.archiveId ? lib.orderedMediaPublications.find((p) => p.id === lib.archiveId) : undefined
  , [lib.orderedMediaPublications, lib.archiveId]);

  // Restore handler
  const handleRestore = useCallback(async () => {
    if (archivePublication) {
      await restoreMediaPublication(archivePublication.id);
      // Invalidate queries via the hook's cache after restore
      lib.setArchiveId(null);
    }
  }, [archivePublication, lib]);

  return (
    <div className="panel p-4 max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2">
          <ImageIcon className="w-5 h-5 text-primary shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <p className="text-xs text-muted-foreground">
              Manage all media publications — Store, POTG, Events, and more. Public{' '}
              <code className="text-[10px] bg-secondary px-1 py-0.5 rounded">/media</code> shows
              published only.
            </p>
          </div>
        </div>
        {/* Actions button group */}
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setPurgeModalOpen(true)}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 text-xs font-semibold bg-[#1C1C1C] border border-[#2E2E2E] text-[#E63946] hover:bg-[#252525] rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            30-Day Purge
          </button>
          <button
            type="button"
            onClick={() => lib.setUploadModeActive(true)}
            disabled={lib.isFetching}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <MediaSearchBar
        query={lib.searchQuery}
        onChange={lib.onSearchChange}
        onClear={lib.clearSearch}
        isSearching={lib.isSearching}
      />

      {/* Filter Bar */}
      <MediaFilterBar
        statusFilter={lib.statusFilter}
        surfaceFilter={lib.surfaceFilter}
        leagueFilter={lib.leagueFilter}
        onStatusChange={lib.setStatusFilter}
        onSurfaceChange={lib.setSurfaceFilter}
        onLeagueChange={lib.setLeagueFilter}
        onReset={lib.resetFilters}
        isLoading={lib.isFetching || lib.isLoading}
        isBulkMode={lib.isBulkMode}
        onToggleBulkMode={lib.toggleBulkMode}
        onOpenStaleCleanup={() => lib.setStaleCleanupOpen(true)}
        orderBy={lib.orderBy}
        onOrderByChange={lib.setOrderBy}
      />

      {/* Bulk Action Bar */}
      {lib.isBulkMode && (
        <MediaBulkActionBar
          selectedCount={lib.selectedCount}
          isArchivePending={lib.isBulkArchivePending}
          error={lib.bulkError}
          onArchive={lib.bulkArchive}
          onCancel={lib.toggleBulkMode}
          onDeselectAll={lib.deselectAll}
        />
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs text-muted-foreground">
          {lib.isFetching ? 'Refreshing...' : `${lib.orderedMediaPublications.length} publications`}
        </div>
        <div className="flex items-center gap-2">
          {lib.isPinning && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Pinning...
            </span>
          )}
          <button
            type="button"
            onClick={lib.saveOrder}
            disabled={!lib.hasPendingOrderChanges || lib.isOrderSaving || lib.isFetching}
            className="flex items-center gap-2 min-h-[44px] px-4 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {lib.isOrderSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving Order...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Order
              </>
            )}
          </button>
          {lib.hasPendingOrderChanges && (
            <button
              type="button"
              onClick={lib.resetOrder}
              disabled={lib.isOrderSaving}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors min-h-[44px] px-2"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Status Messages */}
      {lib.isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading media...
        </div>
      )}
      {lib.isError && (
        <p className="text-xs text-destructive">
          Failed to load media: {(lib.error as Error)?.message ?? 'unknown error'}
        </p>
      )}
      {lib.isSuccess && lib.mediaPublications.length === 0 && !lib.isSearching && (
        <p className="text-xs text-muted-foreground">No publications match these filters.</p>
      )}
      {lib.isSearching && lib.mediaPublications.length === 0 && (
        <p className="text-xs text-muted-foreground">No results for &ldquo;{lib.searchQuery}&rdquo;</p>
      )}
      {lib.patchError && <p className="text-xs text-destructive">Edit failed: {(lib.patchError as Error).message}</p>}
      {lib.deleteError && (
        <p className="text-xs text-destructive">Archive failed: {(lib.deleteError as Error).message}</p>
      )}
      {lib.pinError && <p className="text-xs text-destructive">Pin failed: {(lib.pinError as Error).message}</p>}
      {lib.orderError && <p className="text-xs text-destructive">Save order failed: {(lib.orderError as Error).message}</p>}
      {lib.invalidIds.length > 0 && (
        <p className="text-xs text-destructive">Invalid IDs: {lib.invalidIds.join(', ')}</p>
      )}

      {/* Media List — DnD or fallback */}
      <MediaSortableList
        itemIds={lib.orderedMediaPublications.map((p) => p.id)}
        onDragEnd={lib.handleDragEnd}
        sensors={lib.dragSensors}
      >
        {lib.orderedMediaPublications.map((publication, index) =>
          lib.isBulkMode ? (
            <MediaCard
              key={publication.id}
              publication={publication}
              isEditing={lib.editId === publication.id}
              isBulkMode
              isSelected={lib.selectedIds.has(publication.id)}
              isLoading={lib.isOrderSaving || lib.isFetching}
              editsDisabled={lib.isPatchingPending || lib.isDeletingPending}
              onEdit={() => lib.setEditId(publication.id)}
              onArchive={() => lib.setArchiveId(publication.id)}
              onPreview={() => lib.setPreviewId(publication.id)}
              onRestore={() => lib.setArchiveId(publication.id)}
              onTogglePin={() => lib.togglePin(publication.id, publication.pinnedAt !== null)}
              onToggleSelect={() => lib.toggleSelection(publication.id)}
              onMoveUp={() => lib.dragMoveUp(publication.id)}
              onMoveDown={() => lib.dragMoveDown(publication.id)}
              canMoveUp={index > 0}
              canMoveDown={index < lib.orderedMediaPublications.length - 1}
            />
          ) : (
            <MediaDragCard
              key={publication.id}
              id={publication.id}
              publication={publication}
              isEditing={lib.editId === publication.id}
              isBulkMode={false}
              isSelected={false}
              isLoading={lib.isOrderSaving || lib.isFetching}
              editsDisabled={lib.isPatchingPending || lib.isDeletingPending}
              onEdit={() => lib.setEditId(publication.id)}
              onArchive={() => lib.setArchiveId(publication.id)}
              onPreview={() => lib.setPreviewId(publication.id)}
              onRestore={() => {
                /* handled via archivePublication flow */
              }}
              onTogglePin={() => lib.togglePin(publication.id, publication.pinnedAt !== null)}
              onToggleSelect={() => lib.toggleSelection(publication.id)}
              onMoveUp={() => lib.dragMoveUp(publication.id)}
              onMoveDown={() => lib.dragMoveDown(publication.id)}
              canMoveUp={index > 0}
              canMoveDown={index < lib.orderedMediaPublications.length - 1}
            />
          ),
        )}
      </MediaSortableList>

      {/* Modals / Sheets / Dialogs */}
      <MediaPreviewSheet
        publication={previewPublication}
        isOpen={Boolean(lib.previewId)}
        onEdit={() => {
          if (previewPublication) {
            lib.setPreviewId(null);
            lib.setEditId(previewPublication.id);
          }
        }}
        onArchive={() => {
          if (previewPublication) {
            lib.setPreviewId(null);
            lib.setArchiveId(previewPublication.id);
          }
        }}
        onRestore={() => {
          if (previewPublication) {
            restoreMediaPublication(previewPublication.id);
            lib.setPreviewId(null);
          }
        }}
        onTogglePin={() => {
          if (previewPublication) {
            lib.togglePin(previewPublication.id, previewPublication.pinnedAt !== null);
          }
        }}
        onClose={() => lib.setPreviewId(null)}
      />

      <MediaMetadataSheet
        publication={editPublication}
        isOpen={Boolean(lib.editId)}
        isLoading={lib.isPatchingPending}
        onConfirm={(title, status, leagueId) => {
          if (editPublication) {
            lib.saveMetadata(editPublication.id, title, status, leagueId);
          }
        }}
        onCancel={() => lib.setEditId(null)}
      />

      <ArchiveModal
        publication={archivePublication}
        isOpen={Boolean(lib.archiveId)}
        isLoading={lib.isDeletingPending}
        onConfirm={() => {
          if (archivePublication) {
            lib.archiveMedia(archivePublication.id);
          }
        }}
        onCancel={() => lib.setArchiveId(null)}
      />

      <MediaStaleCleanupDialog
        isOpen={lib.staleCleanupOpen}
        olderThanDays={lib.staleOlderThanDays}
        onOlderThanDaysChange={lib.setStaleOlderThanDays}
        previewResult={lib.stalePreviewResult}
        executeResult={lib.staleExecuteResult}
        isPreviewLoading={lib.isStalePreviewLoading}
        isExecuteLoading={lib.isStaleExecuteLoading}
        previewError={lib.stalePreviewError}
        executeError={lib.staleExecuteError}
        onFetchPreview={lib.fetchStalePreview}
        onExecute={lib.executeStaleCleanup}
        onClose={() => {
          lib.setStaleCleanupOpen(false);
          lib.resetStaleCleanup();
        }}
      />

      <MediaArchivedPurgeModal
        isOpen={purgeModalOpen}
        onClose={() => setPurgeModalOpen(false)}
      />

      <MediaUploadFlow
        isOpen={lib.uploadModeActive}
        step={lib.uploadFlow.step}
        leagueId={lib.uploadFlow.leagueId}
        surface={lib.uploadFlow.surface}
        publishStatus={lib.uploadFlow.publishStatus}
        parserResult={lib.uploadFlow.parserResult}
        fieldOverrides={lib.uploadFlow.fieldOverrides}
        isUploading={lib.isUploading}
        uploadError={lib.uploadError}
        onSetLeague={lib.setUploadLeague}
        onSetSurface={lib.setUploadSurface}
        onSetPublishStatus={lib.setUploadPublishStatus}
        onFileSelected={() => {
          /* file selection handled inside drop step */
        }}
        onOverrideField={lib.overrideParserField}
        onGoBack={lib.uploadGoBack}
        onReset={lib.resetUpload}
        onClose={() => lib.setUploadModeActive(false)}
      />
    </div>
  );
}
