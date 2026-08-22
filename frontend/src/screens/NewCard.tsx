// New Pour Card — the header. Project drives every other picker.
//
// Works with no signal: the form validates locally against cached masters, then
// queues. The user lands on the card immediately so they can start adding laying
// details without waiting for the server to hand back a PC number.

import { useEffect, useMemo, useState } from 'react';
import { ApiError, checkDuplicate } from '../api';
import { sync } from '../sync';
import { useCascade, useStore } from '../store';
import { goBack, navigate } from '../router';
import { Picker } from '../components/Picker';
import { TextField } from '../components/Fields';
import { Note, useToast } from '../components/Feedback';
import {
  IconAlert,
  IconBuilding,
  IconCheck,
  IconCloudOff,
  IconDrop,
  IconFilter,
  IconHat,
  IconPin,
} from '../icons';
import type { CardHeader } from '../types';

const EMPTY: CardHeader = {
  townproject: null,
  zone_name: null,
  village_name: null,
  component: null,
  select_contractor: null,
  from_junction: '',
  to_junction: '',
  custom_chainage_from: '',
  custom_chainage_to: '',
};

/** Junction & Chainage keep only digits, a decimal point and brackets, so a
 *  value like 4.2(9.2) is allowed but stray letters/spaces are not. */
const numLike = (raw: string) => raw.replace(/[^0-9.()]/g, '');

/** Zone applies only to Distribution-network components. For every other
 *  component the Zone field stays hidden and unset. */
function isDistributionComponent(component: string | null): boolean {
  return !!component && component.toLowerCase().includes('distribution');
}

export function NewCard() {
  const { t, caps, masters, syncState } = useStore();
  const cascade = useCascade(masters);
  const toast = useToast();

  const [form, setForm] = useState<CardHeader>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof CardHeader>(key: K, value: CardHeader[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value };

      // A new project invalidates everything scoped to it. Clearing is the
      // honest behaviour — quietly keeping a zone from another project would
      // build a card the server then rejects.
      if (key === 'townproject') {
        next.zone_name = null;
        next.component = null;
        next.select_contractor = null;
      }
      // Zone belongs only to Distribution components — drop it whenever the
      // component is cleared or switched to a non-Distribution one.
      if (key === 'component' && !isDistributionComponent(next.component)) {
        next.zone_name = null;
      }
      return next;
    });
    setDuplicate(null);
  };

  // Default to the user's project when their User Permission scopes them to a
  // single Site Project — one less tap for field staff who only ever work one
  // site. The picker stays fully editable. Only auto-fills on exactly one
  // option, so a user with several projects is never silently pinned to the
  // wrong one; they still choose. Reacts to masters arriving/refreshing, since
  // the scoped list resolves asynchronously.
  const projects = cascade.projects;
  useEffect(() => {
    if (projects.length !== 1) return;
    setForm((current) =>
      current.townproject ? current : { ...current, townproject: projects[0].value },
    );
  }, [projects]);

  const errors = useMemo(() => {
    const found: Partial<Record<keyof CardHeader, string>> = {};
    if (!form.townproject) found.townproject = t('required');
    if (isDistributionComponent(form.component) && !form.zone_name) {
      found.zone_name = t('required');
    }
    if (!form.select_contractor) found.select_contractor = t('required');
    if (!form.from_junction) found.from_junction = t('required');
    if (!form.to_junction) found.to_junction = t('required');

    if (form.from_junction && form.to_junction && form.from_junction === form.to_junction) {
      found.to_junction = t('same_junction');
    }
    return found;
  }, [form, t]);

  const complete = Object.keys(errors).length === 0;

  // Check for a clashing card as soon as the key is complete, so the user finds
  // out before walking to the next junction. Debounced, and skipped offline —
  // the server enforces the same rule on save either way.
  useEffect(() => {
    if (!complete || !syncState.online) return;

    const timer = window.setTimeout(async () => {
      try {
        const result = await checkDuplicate(form);
        setDuplicate(result.duplicate);
      } catch {
        /* a failed pre-check must not block the form */
      }
    }, 600);

    return () => window.clearTimeout(timer);
  }, [form, complete, syncState.online]);

  const submit = async () => {
    setTouched(true);
    if (!complete) {
      toast.err(t('error_generic'));
      return;
    }
    if (duplicate) {
      toast.err(t('duplicate_found', { name: duplicate }));
      return;
    }

    setSaving(true);
    try {
      const { cardName } = await sync.queueSaveCard(form, { company: caps.default_company });

      // Give a fast connection a moment to land so the real PC number shows —
      // but never block on it.
      await new Promise((resolve) => window.setTimeout(resolve, 600));

      if (syncState.online) toast.ok(t('card_created'));
      else toast.info(t('saved_offline'));

      navigate({ name: 'card', id: cardName });
    } catch (error) {
      toast.err(error instanceof ApiError ? error.message : t('error_generic'));
    } finally {
      setSaving(false);
    }
  };

  const show = (key: keyof CardHeader) => (touched ? errors[key] ?? null : null);
  const project = form.townproject;
  const projectHint = project ? t('no_results') : t('select_project_first');
  const showZone = isDistributionComponent(form.component);

  if (!caps.create) {
    return (
      <div className="pane">
        <div className="pad">
          <Note kind="err" icon={<IconAlert />}>
            {t('no_permission')}
          </Note>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pane">
        <div className="pad">
          {!syncState.online ? (
            <Note kind="warn" icon={<IconCloudOff />} style={{ marginBottom: 14 }}>
              {t('working_offline')}
            </Note>
          ) : null}

          {duplicate ? (
            <Note kind="err" icon={<IconAlert />} style={{ marginBottom: 14 }}>
              {t('duplicate_found', { name: duplicate })}
            </Note>
          ) : null}

          <div className="eyebrow" style={{ marginBottom: 12 }}>
            {t('sec_project')}
          </div>

          <Picker
            label={t('project')}
            value={form.townproject}
            onChange={(value) => set('townproject', value)}
            options={cascade.projects}
            t={t}
            required
            icon={<IconBuilding />}
            error={show('townproject')}
          />

          {/* Village is never collected on mobile (reqd=0, hidden on the desk). */}

          <Picker
            label={t('component')}
            value={form.component}
            onChange={(value) => set('component', value)}
            options={cascade.componentsFor(project)}
            t={t}
            optional
            disabled={!project}
            emptyHint={projectHint}
            icon={<IconDrop />}
          />

          {/* Zone shows only for a Distribution component, directly below it. */}
          {showZone ? (
            <Picker
              label={t('zone')}
              value={form.zone_name}
              onChange={(value) => set('zone_name', value)}
              options={cascade.zonesFor(project)}
              t={t}
              required
              disabled={!project}
              emptyHint={projectHint}
              icon={<IconPin />}
              error={show('zone_name')}
            />
          ) : null}

          <Picker
            label={t('contractor')}
            value={form.select_contractor}
            onChange={(value) => set('select_contractor', value)}
            options={cascade.contractorsFor(project)}
            t={t}
            required
            disabled={!project}
            emptyHint={projectHint}
            icon={<IconHat />}
            error={show('select_contractor')}
          />

          <div className="grid2" style={{ marginBottom: 8 }}>
            <TextField
              label={t('from_junction')}
              value={form.from_junction}
              onChange={(value) => set('from_junction', value)}
              sanitize={numLike}
              required
              maxLength={20}
              placeholder="e.g. 4.2(9.2)"
              error={show('from_junction')}
            />
            <TextField
              label={t('to_junction')}
              value={form.to_junction}
              onChange={(value) => set('to_junction', value)}
              sanitize={numLike}
              required
              maxLength={20}
              placeholder="e.g. 4.2(9.2)"
              error={show('to_junction')}
            />
          </div>

          <div className="grid2" style={{ marginBottom: 8 }}>
            <TextField
              label={t('chainage_from')}
              value={form.custom_chainage_from}
              onChange={(value) => set('custom_chainage_from', value)}
              sanitize={numLike}
              optional
              maxLength={20}
              placeholder="e.g. 4.2(9.2)"
              t={t}
            />
            <TextField
              label={t('chainage_to')}
              value={form.custom_chainage_to}
              onChange={(value) => set('custom_chainage_to', value)}
              sanitize={numLike}
              optional
              maxLength={20}
              placeholder="e.g. 4.2(9.2)"
              t={t}
            />
          </div>

          <Note kind="warn" icon={<IconFilter />} style={{ margin: '8px 0 16px' }}>
            {t('dup_note')}
          </Note>
        </div>
      </div>

      <div className="actionbar">
        <div className="btn-row">
          <button className="btn secondary" onClick={() => goBack()} disabled={saving}>
            {t('cancel')}
          </button>
          <button
            className="btn primary"
            onClick={submit}
            disabled={saving || !!duplicate}
            style={{ flex: '2 1 0' }}
          >
            <IconCheck />
            <span>{t('create_card')}</span>
          </button>
        </div>
      </div>
    </>
  );
}
