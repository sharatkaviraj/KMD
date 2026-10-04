"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { placePhotoAction, type PhotoResult } from "@/app/(app)/collection/photos/actions";
import { m } from "@/messages";
import { ms } from "@/messages/setup";
import {
  photoAmbiguityLabels,
  placePhotos,
  PHOTO_MAX_SIDE,
  type PhotoMatch,
} from "@/modules/collection/domain/photo-placement";
import { primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Notice, Select } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

export type PhotoRosterChild = {
  studentId: string;
  name: string;
  srNo: string | null;
  externalId: string | null;
  photoId: string | null;
  photoUrl: string | null;
};

/**
 * Shrink a photograph on the device before it travels: a face on a card needs
 * no more than PHOTO_MAX_SIDE pixels, and a phone's twelve-megapixel original
 * over a school's connection is the upload that never finishes.
 */
async function downscale(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not prepare the photograph.");
  return { blob, width, height };
}

/**
 * Send one photograph. The command id is minted per photograph and reused if
 * the answer is lost, so a retry is asked about rather than placed twice.
 */
async function send(input: {
  file: File;
  studentId: string;
  expectedCurrent: string | null;
  source: "camera" | "file" | "folder";
  commandId: string;
}): Promise<PhotoResult> {
  const { blob, width, height } = await downscale(input.file);
  const form = new FormData();
  form.set("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
  form.set("commandId", input.commandId);
  form.set("studentId", input.studentId);
  form.set("expectedCurrent", input.expectedCurrent ?? "");
  form.set("source", input.source);
  form.set("sourceRef", input.file.name);
  form.set("width", String(width));
  form.set("height", String(height));
  try {
    return await placePhotoAction(form);
  } catch {
    // The answer was lost: ask again with the same id.
    return placePhotoAction(form);
  }
}

/** One child: the photograph or its absence, and the two ways to place one. */
export function PhotoTile({ child }: { child: PhotoRosterChild }) {
  const language = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: Localized } | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const choose = (source: "camera" | "file") => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    startTransition(async () => {
      const result = await send({ file, studentId: child.studentId, expectedCurrent: child.photoId, source, commandId: crypto.randomUUID() });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3" data-photo-child={child.studentId} data-has-photo={child.photoId ? "yes" : "no"}>
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 text-[11px] text-subtle-foreground">
        {child.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived private URL; next/image would cache it.
          <img src={child.photoUrl} alt={child.name} className="size-full object-cover" />
        ) : (
          primary(ms.photoMissing, language)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-foreground">{child.name}</p>
        <p className="text-[12px] text-subtle-foreground">SR {child.srNo ?? "—"}</p>
        {message ? <Notice tone={message.ok ? "success" : "danger"} text={message.text} language={language} /> : null}
        <div className="mt-1 flex flex-wrap gap-2">
          <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={choose("camera")} aria-hidden />
          <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={choose("file")} aria-hidden />
          <Button type="button" size="sm" variant="outline" loading={pending} loadingText={primary(m.saving, language)} onClick={() => camera.current?.click()}>
            {primary(child.photoId ? ms.photoRetake : ms.photoTake, language)}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => picker.current?.click()}>
            {primary(ms.photoChooseFile, language)}
          </Button>
        </div>
      </div>
    </div>
  );
}

type Planned = { file: File; match: PhotoMatch; chosen: string };

/**
 * A folder of photographs, placed by filename. A file whose name holds one
 * child's id or SR number is matched; anything else — no id, two ids, two
 * files for one child — waits in the tray for a person to choose. Nothing is
 * placed until they press the button, and then one at a time, with progress.
 */
export function FolderPlacement({ roster }: { roster: PhotoRosterChild[] }) {
  const language = useLanguage();
  const router = useRouter();
  const [planned, setPlanned] = useState<Planned[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: { name: string; text: Localized }[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const byId = useMemo(() => new Map(roster.map((child) => [child.studentId, child])), [roster]);

  const read = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    const placed = placePhotos(
      files.map((file) => file.name),
      roster.map((child) => ({ studentId: child.studentId, externalId: child.externalId, srNo: child.srNo })),
    );
    setProgress(null);
    setPlanned(
      placed.map((entry, index) => ({
        file: files[index]!,
        match: entry.match,
        chosen: entry.match.kind === "matched" ? entry.match.studentId : "",
      })),
    );
  };

  const ready = planned.filter((entry) => entry.chosen !== "");
  const tray = planned.filter((entry) => entry.match.kind !== "matched");

  const place = () =>
    startTransition(async () => {
      const failed: { name: string; text: Localized }[] = [];
      setProgress({ done: 0, total: ready.length, failed });
      for (const [index, entry] of ready.entries()) {
        const child = byId.get(entry.chosen);
        const result = await send({
          file: entry.file,
          studentId: entry.chosen,
          expectedCurrent: child?.photoId ?? null,
          source: "folder",
          commandId: crypto.randomUUID(),
        });
        if (!result.ok) failed.push({ name: entry.file.name, text: result.message });
        setProgress({ done: index + 1, total: ready.length, failed: [...failed] });
      }
      setPlanned([]);
      router.refresh();
    });

  return (
    <div className="space-y-3" data-photo-folder>
      <label className="block text-[13px] font-medium text-foreground">
        {primary(ms.photoFolder, language)}
        <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="mt-1 block text-[13px]" onChange={read} name="folder" />
      </label>

      {planned.length > 0 ? (
        <ul className="space-y-1.5 text-[13px]" data-photo-plan>
          {planned.map((entry, index) => (
            <li key={`${entry.file.name}-${index}`} className="flex flex-wrap items-center gap-2" data-photo-file={entry.file.name} data-match={entry.match.kind}>
              <span className="font-medium">{entry.file.name}</span>
              <span aria-hidden>→</span>
              {entry.match.kind === "matched" ? (
                <span>{byId.get(entry.match.studentId)?.name ?? "—"}</span>
              ) : (
                <>
                  {entry.match.kind === "ambiguous" ? (
                    <span className="text-warning">{primary(photoAmbiguityLabels[entry.match.why], language)}</span>
                  ) : (
                    <span className="text-subtle-foreground">{primary(ms.photoNoMatch, language)}</span>
                  )}
                  <Select
                    aria-label={primary(ms.photoWhichChild, language)}
                    className="h-9 min-w-40"
                    value={entry.chosen}
                    onChange={(event) =>
                      setPlanned((current) => current.map((item, at) => (at === index ? { ...item, chosen: event.target.value } : item)))
                    }
                  >
                    <option value="">{primary(ms.photoLeaveOut, language)}</option>
                    {roster.map((child) => (
                      <option key={child.studentId} value={child.studentId}>
                        {child.name} · SR {child.srNo ?? "—"}
                      </option>
                    ))}
                  </Select>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {tray.length > 0 ? <Notice tone="warning" text={ms.photoTrayHint} language={language} /> : null}

      {planned.length > 0 ? (
        <Button type="button" onClick={place} loading={pending} loadingText={primary(m.saving, language)} disabled={ready.length === 0}>
          {primary(ms.photoPlaceAll, language)} ({ready.length})
        </Button>
      ) : null}

      {progress ? (
        <p className="text-[13px]" role="status" data-photo-progress>
          {progress.done} / {progress.total}
          {progress.failed.length > 0 ? (
            <span className="block text-destructive-soft-foreground">
              {progress.failed.map((entry) => `${entry.name}: ${primary(entry.text, language)}`).join(" · ")}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
