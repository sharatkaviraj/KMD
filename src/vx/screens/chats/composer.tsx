"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { MAX_CHAT_CAPTION, MAX_CHAT_TEXT } from "@/modules/chats/domain/words";
import { MAX_CHAT_FILE_BYTES } from "@/modules/chats/domain/files";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";
import { appendSpoken, useHeardText, useSpeech, Waveform, type HeardStore } from "@/vx/ui/voice";

import { beginUploadAction, sendChatAction, type SendResult } from "@/app/(app)/chats/actions";

import { localLine, newRef, photoName, pickedKind, quickReplies, sizeWords, speechLang, windowState } from "./logic";
import { readyPhoto } from "./photo";
import type { ChatFileView, ChatHeadView, ChatMessageView } from "./view";
import { T } from "./words";

/*
 * The box at the bottom of a chat (D-616), made for people who do not use
 * apps much: a big box to type in, a big green Send, and plainly labelled
 * buttons under it to speak instead of typing, add a photo, take one with the
 * camera or add a PDF. One line above the box says whether the parent gets
 * it now or when they next write. Ready replies in the parent's language sit
 * above an empty box.
 *
 * Sending draws the message at once with a clock; the saved one replaces it
 * with its ticks. When it cannot go, the line goes away again and the words
 * are back in the box, with the reason.
 */

type Attachment = {
  kind: "image" | "document";
  blob: Blob;
  name: string;
  mime: string;
  /** A photo's small picture, for the box and the line drawn while it sends. */
  preview: string | null;
};

type Phase = "preparing" | "uploading" | "sending" | null;

const UPLOAD_BUCKET = "parent-chat-files";

/** The words heard so far, live in the box while listening; only this re-draws on each word. */
function LiveBox({ text, heard, store, placeholder, id }: { text: string; heard: string; store: HeardStore; placeholder: string; id: string }) {
  const live = appendSpoken(heard, useHeardText(store));
  return <textarea id={id} rows={1} readOnly value={appendSpoken(text, live)} placeholder={placeholder} aria-live="polite" />;
}

export function Composer({
  head,
  now,
  myName,
  onLocal,
  onSettle,
  onMoved,
  onSendingChange,
}: {
  head: ChatHeadView;
  now: string;
  myName: string;
  /** Draw a line at once, before it is saved. */
  onLocal: (line: ChatMessageView) => void;
  /** The saved line for `ref`, or null when nothing was kept (the drawn line goes away). */
  onSettle: (ref: string, saved: ChatMessageView | null) => void;
  onMoved: (to: string) => void;
  onSendingChange?: (sending: boolean) => void;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const boxId = useId();
  const [text, setText] = useState("");
  const [heard, setHeard] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [problem, setProblem] = useState<Pair | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const speech = useSpeech((said) => setHeard((current) => appendSpoken(current, said)));
  const listening = speech.listening;
  const busy = phase !== null;

  // A photo's small picture is a blob address: let it go when the photo leaves the box.
  const previewUrl = attachment?.preview ?? null;
  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => {
      // The line drawn while sending may still show it for a moment.
      window.setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
    };
  }, [previewUrl]);

  // The box grows with what is written, up to a few lines, then scrolls.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text, listening]);

  const limit = attachment ? MAX_CHAT_CAPTION : MAX_CHAT_TEXT;
  const tooLong = text.trim().length > limit;
  const window_ = windowState(head.windowUntil, now);

  const liveNow = () => appendSpoken(heard, speech.heard.get()).trim();

  const stopListening = () => {
    const live = liveNow();
    speech.stop();
    if (live) setText((current) => appendSpoken(current, live));
    setHeard("");
  };

  const toggleSpeech = () => {
    if (listening) {
      cue("stop");
      stopListening();
      box.current?.focus();
      return;
    }
    cue("listen");
    setHeard("");
    speech.start(speechLang(head.language));
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    setProblem(null);
    const kind = pickedKind(file.name, file.type);
    if (!kind) {
      setProblem(T.fileWrongType);
      cue("warn");
      return;
    }
    if (kind.kind === "document") {
      if (file.size > MAX_CHAT_FILE_BYTES) {
        setProblem(T.fileTooBig);
        cue("warn");
        return;
      }
      setAttachment({ kind: "document", blob: file, name: file.name, mime: kind.mime, preview: null });
      cue("select");
      return;
    }
    setPhase("preparing");
    try {
      const photo = await readyPhoto(file);
      setAttachment({ kind: "image", blob: photo.blob, name: photoName(new Date().toISOString()), mime: "image/jpeg", preview: URL.createObjectURL(photo.blob) });
      cue("select");
    } catch {
      setProblem(p("That photo could not be read. Choose another one.", "वह फ़ोटो पढ़ी नहीं जा सकी। दूसरी चुनें।"));
      cue("warn");
    } finally {
      setPhase(null);
    }
  };

  const restore = (words: string, file: Attachment | null) => {
    setText((current) => (current.trim() ? current : words));
    if (file) setAttachment((current) => current ?? file);
  };

  const fail = (ref: string, words: string, file: Attachment | null, why: Pair, moved?: string) => {
    onSettle(ref, null);
    restore(words, file);
    setProblem(why);
    toast.show({ tone: "bad", text: tx(why) });
    if (moved) onMoved(moved);
  };

  const send = async () => {
    if (busy) return;
    const live = listening ? liveNow() : "";
    if (listening) speech.stop();
    setHeard("");
    const words = (live ? appendSpoken(text, live) : text).trim();
    const file = attachment;
    if (!words && !file) {
      setProblem(p("Write something, or add a photo or file.", "कुछ लिखें, या फ़ोटो या फ़ाइल जोड़ें।"));
      cue("warn");
      box.current?.focus();
      return;
    }
    if (words.length > (file ? MAX_CHAT_CAPTION : MAX_CHAT_TEXT)) {
      setProblem(p("That message is too long for WhatsApp. Make it shorter.", "यह संदेश व्हाट्सऐप के लिए बहुत लंबा है। छोटा करें।"));
      cue("warn");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.show({ tone: "bad", text: tx(T.offline) });
      return;
    }
    setProblem(null);
    const ref = newRef();
    const drawnFile: ChatFileView | null = file
      ? { url: file.preview ?? "", name: file.name, mime: file.mime, bytes: file.blob.size, kind: file.kind === "image" ? "image" : "document", voice: false }
      : null;
    onLocal(localLine({ ref, text: words, at: new Date().toISOString(), by: { en: myName }, file: drawnFile }));
    setText("");
    setAttachment(null);
    onSendingChange?.(true);
    try {
      let sent: { path: string; filename: string } | null = null;
      if (file) {
        setPhase("uploading");
        const begun = await beginUploadAction({ chatId: head.id, mime: file.mime, bytes: file.blob.size, kind: file.kind });
        if (!begun.ok) {
          fail(ref, words, file, begun.words, begun.moved);
          return;
        }
        const { createClient } = await import("@/platform/supabase/client");
        const { error } = await createClient().storage.from(UPLOAD_BUCKET).uploadToSignedUrl(begun.path, begun.token, file.blob, { contentType: file.mime, upsert: false });
        if (error) {
          fail(ref, words, file, T.uploadFailed);
          return;
        }
        sent = { path: begun.path, filename: file.name };
      }
      setPhase("sending");
      const result: SendResult = await sendChatAction({ chatId: head.id, clientRef: ref, text: words, file: sent });
      if (!result.ok) {
        fail(ref, words, file, result.words, result.moved);
        return;
      }
      onSettle(ref, result.message);
      if (result.delivery === "waiting") toast.show({ tone: "info", text: tx(T.waitingToast), cue: "success" });
      else if (result.delivery === "failed") toast.show({ tone: "bad", text: tx(T.tapToRetry) });
      else cue("success");
    } catch {
      fail(ref, words, file, navigator.onLine === false ? T.offline : T.failedToast);
    } finally {
      setPhase(null);
      onSendingChange?.(false);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    // A computer sends on Enter, as WhatsApp on a computer does; a phone's Enter is a new line.
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    event.preventDefault();
    void send();
  };

  const pickQuick = (line: string) => {
    cue("tap");
    setText((current) => (current.trim() ? `${current.trim()} ${line}` : line));
    box.current?.focus();
  };

  const placeholder = tx(attachment ? T.placeholderFile : T.placeholder);
  const showQuick = !text.trim() && !attachment && !listening && !busy;
  const phaseWords = phase === "preparing" ? T.preparing : phase === "uploading" ? T.uploading : phase === "sending" ? T.sending : null;

  return (
    <div className="chat-compose">
      <div className={`chat-window${window_ === "open" ? "" : " closed"}`}>
        <Ic n={window_ === "open" ? "checkCircle" : "clock"} size={14} style={{ marginTop: 1 }} />
        <span>{tx(window_ === "open" ? T.windowOpen : T.windowClosed)}</span>
      </div>

      {showQuick ? (
        <div className="chat-quick" role="group" aria-label={tx(T.quick)}>
          {quickReplies(head.language).map((line) => (
            <button key={line} type="button" className="tap" onClick={() => pickQuick(line)} title={line}>
              {line}
            </button>
          ))}
        </div>
      ) : null}

      {attachment ? (
        <div className="chat-attach">
          {attachment.preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local photo before it is sent
            <img src={attachment.preview} alt={tx(T.photo)} />
          ) : (
            <span className="chat-attach-ic" aria-hidden="true">
              <Ic n="fileText" size={26} />
            </span>
          )}
          <span className="chat-attach-name">
            <span className="clip">{attachment.name}</span>
            <small>{sizeWords(attachment.blob.size)}</small>
          </span>
          <button type="button" className="tap btn ghost" disabled={busy} onClick={() => setAttachment(null)} aria-label={tx(T.removeFile)}>
            <Ic n="x" size={18} />
            <span className="chat-hide-s">{tx(T.removeFile)}</span>
          </button>
        </div>
      ) : null}

      {listening ? (
        <div className="chat-listen" role="status">
          <Waveform />
          <span>{tx(T.listening)}</span>
        </div>
      ) : null}

      <div className="chat-row2">
        <label className="chat-box" htmlFor={boxId}>
          <span className="sr">{placeholder}</span>
          {listening ? (
            <LiveBox id={boxId} text={text} heard={heard} store={speech.heard} placeholder={placeholder} />
          ) : (
            <textarea
              id={boxId}
              ref={box}
              rows={1}
              value={text}
              placeholder={placeholder}
              onChange={(event) => {
                setText(event.target.value);
                if (problem) setProblem(null);
              }}
              onKeyDown={onKey}
              enterKeyHint="enter"
              autoComplete="off"
              spellCheck
              lang={head.language === "en" ? "en" : "hi"}
            />
          )}
        </label>
        <button type="button" className="chat-send tap" onClick={() => void send()} disabled={busy || tooLong} aria-label={tx(T.send)}>
          {busy ? <Ic n="refresh" size={22} className="spin" /> : <Ic n="send" size={22} />}
          <span className="chat-send-w">{tx(busy && phaseWords ? phaseWords : T.send)}</span>
        </button>
      </div>

      {problem || tooLong || phaseWords ? (
        <div className={`chat-hint${problem || tooLong ? " bad" : ""}`} role={problem ? "alert" : "status"}>
          <Ic n={problem || tooLong ? "alert" : "clock"} size={14} />
          <span>{problem ? tx(problem) : tooLong ? tx(p(`Too long: ${text.trim().length} of ${limit} letters`, `बहुत लंबा: ${limit} में से ${text.trim().length} अक्षर`)) : phaseWords ? tx(phaseWords) : null}</span>
        </div>
      ) : null}

      <div className="chat-tools">
        {speech.supported ? (
          <button type="button" className={`chat-tool tap${listening ? " on" : ""}`} aria-pressed={listening} onClick={toggleSpeech} disabled={busy}>
            <Ic n="mic" size={18} />
            {tx(listening ? T.stop : T.speak)}
          </button>
        ) : null}
        <button type="button" className="chat-tool tap" onClick={() => photoInput.current?.click()} disabled={busy || listening}>
          <Ic n="image" size={18} />
          {tx(T.photo)}
        </button>
        <button type="button" className="chat-tool tap chat-camera" onClick={() => cameraInput.current?.click()} disabled={busy || listening}>
          <Ic n="camera" size={18} />
          {tx(T.camera)}
        </button>
        <button type="button" className="chat-tool tap" onClick={() => fileInput.current?.click()} disabled={busy || listening}>
          <Ic n="fileText" size={18} />
          {tx(T.file)}
        </button>
        <input ref={photoInput} type="file" accept="image/*" hidden onChange={(event) => void choose(event)} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void choose(event)} />
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(event) => void choose(event)}
        />
      </div>
      {speech.errorP ? (
        <div className="chat-hint bad" role="alert">
          <Ic n="alert" size={14} />
          <span>{tx(speech.errorP)}</span>
        </div>
      ) : null}
    </div>
  );
}
