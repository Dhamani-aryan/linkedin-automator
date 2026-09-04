import { Chrome, Info, Mail, Save, User, X } from "lucide-react";
import { useState } from "react";
import type { LinkedInAccount } from "../types";

type AddLinkedInAccountModalProps = {
  onAdd: (account: LinkedInAccount) => void;
  onClose: () => void;
};

export function AddLinkedInAccountModal({ onAdd, onClose }: AddLinkedInAccountModalProps) {
  const [form, setForm] = useState({
    name: "",
    email: ""
  });

  function submitAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name || !email) return;

    onAdd({
      id: crypto.randomUUID(),
      email,
      name,
      state: "stopped",
      role: "Owner",
      chromeProfileMode: "single-local-profile",
      archived: false
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="account-modal">
        <header className="modal-header">
          <div>
            <h2>Add LinkedIn profile</h2>
            <p>Start Chrome after adding it, log in once, and this computer keeps that LinkedIn session.</p>
          </div>
          <button className="icon-text-button" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <form className="auth-form" onSubmit={submitAccount}>
          <label htmlFor="linkedin-name">Profile label</label>
          <div className="input-with-icon">
            <User size={18} />
            <input
              id="linkedin-name"
              placeholder="Jay Parekh LinkedIn"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </div>

          <label htmlFor="linkedin-email">LinkedIn email</label>
          <div className="input-with-icon">
            <Mail size={18} />
            <input
              id="linkedin-email"
              type="email"
              placeholder="linkedin-profile@example.com"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </div>

          <div className="login-persistence-note">
            <Info size={18} />
            <div>
              <strong>Its own Chrome, its own login</strong>
              <span>
                This profile gets its own Chrome folder and window, separate from every other profile.
                Sign in once inside that window and the session stays, including the check that this
                device already passed two-step verification. All profiles still share this computer and
                its IP address.
              </span>
            </div>
          </div>

          <div className="chrome-flow-card">
            <Chrome size={22} />
            <div>
              <strong>After adding</strong>
              <span>Click start to open this profile's Chrome window, sign in to LinkedIn there, and every later start reuses that login.</span>
            </div>
          </div>

          <footer className="modal-actions">
            <button className="ghost-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="submit">
              <Save size={18} />
              Add profile
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
