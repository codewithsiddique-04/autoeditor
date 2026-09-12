import { useRef } from "react";
import { SFX_LIBRARY } from "../../lib/sfx";
import { previewSfx } from "../../lib/sfxScheduler";

// The Audio tab: pick a sound (bundled or uploaded), then click the FX track to
// place it. ▶ previews; Upload adds your own .mp3/.wav to this project.
export default function AudioPanel({ selectedSound, setSelectedSound, sfxUploads = [], uploadSfx }) {
  const fileRef = useRef(null);

  const bundled = SFX_LIBRARY.map((s) => ({ name: s.label, url: s.file, src: { kind: "lib", file: s.file } }));
  const uploaded = sfxUploads.map((u) => ({ name: u.label, url: u.url, src: { kind: "upload", mediaId: u.mediaId } }));
  const isOn = (snd) => selectedSound && selectedSound.url === snd.url;

  const onPick = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f && uploadSfx) uploadSfx(f);
  };

  const row = (snd) => (
    <div key={snd.url} className={`sfxrow ${isOn(snd) ? "is-on" : ""}`}>
      <button
        type="button" className="sfxrow__play"
        title="Preview"
        onClick={(e) => { e.stopPropagation(); previewSfx(snd.url, 0.9); }}
      >▶</button>
      <button
        type="button" className="sfxrow__name"
        onClick={() => setSelectedSound && setSelectedSound(snd)}
      >{snd.name}</button>
    </div>
  );

  return (
    <div className="panel">
      <h2 className="panel__h">Sound effects</h2>
      <div className="mini-h">Select a sound, then click the <b>FX</b> track to place it. Drag a marker to move it; click it to set volume or remove.</div>

      <div className="mini-h" style={{ marginTop: 12 }}>Library</div>
      <div className="sfxlist">{bundled.map(row)}</div>

      {uploaded.length > 0 && (
        <>
          <div className="mini-h" style={{ marginTop: 12 }}>Your uploads</div>
          <div className="sfxlist">{uploaded.map(row)}</div>
        </>
      )}

      <button type="button" className="trall" style={{ marginTop: 12 }} onClick={() => fileRef.current && fileRef.current.click()}>
        ⤒ Upload .mp3 / .wav
      </button>
      <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav" hidden onChange={onPick} />
    </div>
  );
}
