import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

// ── Phone validation (same logic as contacts.ts) ────────────────────────────

function validateAndFormatPhone(phone: string): { e164: string } | { error: string } {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed || !parsed.isValid()) {
    return { error: 'Invalid phone number' };
  }
  return { e164: parsed.format('E.164').replace(/^\+/, '') };
}

// ── Auto-mapping dictionary ─────────────────────────────────────────────────

const HEADER_MAP: Record<string, string> = {
  phone: 'phone_number',
  phonenumber: 'phone_number',
  phone_number: 'phone_number',
  mobile: 'phone_number',
  cell: 'phone_number',
  telephone: 'phone_number',
  tel: 'phone_number',
  whatsapp: 'phone_number',
  firstname: 'first_name',
  first_name: 'first_name',
  first: 'first_name',
  givenname: 'first_name',
  lastname: 'last_name',
  last_name: 'last_name',
  last: 'last_name',
  surname: 'last_name',
  familyname: 'last_name',
  email: 'email',
  emailaddress: 'email',
  e_mail: 'email',
  company: 'company',
  companyname: 'company',
  organization: 'company',
  org: 'company',
  notes: 'notes',
  note: 'notes',
  tags: 'tags',
  tag: 'tags',
  street: 'address_street',
  streetaddress: 'address_street',
  address: 'address_street',
  addressstreet: 'address_street',
  city: 'address_city',
  addresscity: 'address_city',
  state: 'address_state',
  province: 'address_state',
  addressstate: 'address_state',
  postalcode: 'address_postal_code',
  zipcode: 'address_postal_code',
  zip: 'address_postal_code',
  postcode: 'address_postal_code',
  addresspostalcode: 'address_postal_code',
  country: 'address_country',
  addresscountry: 'address_country',
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_\-\.]/g, '');
}

// ── In-memory session store ─────────────────────────────────────────────────

interface ImportSession {
  companyId: string;
  userId: string;
  headers: string[];
  rows: Record<string, string>[];
  createdAt: number;
}

const importSessions = new Map<string, ImportSession>();
const SESSION_TTL_MS = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of importSessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      importSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ── Multer config ───────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

// ── Router ──────────────────────────────────────────────────────────────────

const router = Router();
router.use(requireAuth);

// ── POST /import/parse ──────────────────────────────────────────────────────

router.post(
  '/import/parse',
  requirePermission('contacts', 'create'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        res.status(400).json({ error: 'Unsupported file type. Please upload CSV or Excel.' });
        return;
      }

      const XLSX = await import('xlsx');
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      if (rawRows.length < 2) {
        res.status(400).json({ error: 'File must have a header row and at least one data row' });
        return;
      }

      const headers = rawRows[0].map((h) => String(h).trim());
      const rows: Record<string, string>[] = [];

      for (let i = 1; i < rawRows.length; i++) {
        const row: Record<string, string> = {};
        let hasData = false;
        for (let j = 0; j < headers.length; j++) {
          const val = String(rawRows[i][j] ?? '').trim();
          row[headers[j]] = val;
          if (val) hasData = true;
        }
        if (hasData) rows.push(row);
      }

      if (rows.length === 0) {
        res.status(400).json({ error: 'No data rows found in file' });
        return;
      }

      // Auto-suggest mappings
      const suggestedMappings: Record<string, string> = {};
      for (const header of headers) {
        const normalized = normalizeHeader(header);
        if (HEADER_MAP[normalized]) {
          suggestedMappings[header] = HEADER_MAP[normalized];
        }
      }

      // Also try to match against custom field definitions
      const { data: customDefs } = await supabaseAdmin
        .from('custom_field_definitions')
        .select('id, name')
        .eq('company_id', req.companyId!)
        .eq('is_active', true);

      if (customDefs) {
        for (const header of headers) {
          if (suggestedMappings[header]) continue;
          const normalized = normalizeHeader(header);
          const match = customDefs.find((d) => normalizeHeader(d.name) === normalized);
          if (match) {
            suggestedMappings[header] = `custom:${match.id}`;
          }
        }
      }

      const sessionId = crypto.randomUUID();
      importSessions.set(sessionId, {
        companyId: req.companyId!,
        userId: req.userId!,
        headers,
        rows,
        createdAt: Date.now(),
      });

      res.json({
        sessionId,
        headers,
        sampleRows: rows.slice(0, 5),
        totalRows: rows.length,
        suggestedMappings,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /import/preview ────────────────────────────────────────────────────

router.post('/import/preview', requirePermission('contacts', 'create'), async (req, res, next) => {
  try {
    const { sessionId, mappings, settings } = req.body as {
      sessionId: string;
      mappings: Record<string, string>;
      settings: { duplicateHandling: string; listId?: string; defaultTags?: string[] };
    };

    const session = importSessions.get(sessionId);
    if (!session || session.companyId !== req.companyId!) {
      res.status(404).json({ error: 'Import session not found or expired' });
      return;
    }

    // Check phone_number is mapped
    const phoneHeader = Object.entries(mappings).find(([, v]) => v === 'phone_number')?.[0];
    if (!phoneHeader) {
      res.status(400).json({ error: 'phone_number field must be mapped' });
      return;
    }

    const warnings: { row: number; field: string; message: string }[] = [];
    const errors: { row: number; field: string; message: string }[] = [];
    const phoneNumbers: string[] = [];

    // Transform and validate each row
    const transformedRows = session.rows.map((row, idx) => {
      const transformed: Record<string, unknown> = {};
      for (const [sourceHeader, destField] of Object.entries(mappings)) {
        if (!destField || destField === 'skip') continue;
        transformed[destField] = row[sourceHeader] || '';
      }

      // Validate phone
      const rawPhone = String(transformed.phone_number || '');
      if (!rawPhone) {
        errors.push({ row: idx + 2, field: 'phone_number', message: 'Missing phone number' });
        return { ...transformed, _status: 'error' as const, _row: idx + 2 };
      }

      const phoneResult = validateAndFormatPhone(rawPhone);
      if ('error' in phoneResult) {
        errors.push({ row: idx + 2, field: 'phone_number', message: phoneResult.error });
        return { ...transformed, _status: 'error' as const, _row: idx + 2 };
      }
      transformed.phone_number = phoneResult.e164;
      phoneNumbers.push(phoneResult.e164);

      // Validate email if present
      const email = String(transformed.email || '');
      if (email && !email.includes('@')) {
        warnings.push({ row: idx + 2, field: 'email', message: 'Invalid email format' });
        return { ...transformed, _status: 'warning' as const, _row: idx + 2 };
      }

      return { ...transformed, _status: 'valid' as const, _row: idx + 2 };
    });

    // Check for duplicates against existing contacts
    const duplicates: { row: number; phone: string; existingContactId: string }[] = [];
    if (phoneNumbers.length > 0) {
      // Query in batches of 200
      for (let i = 0; i < phoneNumbers.length; i += 200) {
        const batch = phoneNumbers.slice(i, i + 200);
        const { data: existing } = await supabaseAdmin
          .from('contacts')
          .select('id, phone_number')
          .eq('company_id', session.companyId)
          .eq('is_deleted', false)
          .in('phone_number', batch);

        if (existing) {
          const existingMap = new Map(existing.map((c) => [c.phone_number, c.id]));
          for (const row of transformedRows) {
            if (row._status === 'error') continue;
            const phone = String((row as Record<string, unknown>).phone_number);
            if (existingMap.has(phone)) {
              duplicates.push({
                row: row._row,
                phone,
                existingContactId: existingMap.get(phone)!,
              });
            }
          }
        }
      }
    }

    const validRows = transformedRows.filter((r) => r._status === 'valid').length;
    const warningRows = transformedRows.filter((r) => r._status === 'warning').length;
    const errorRows = transformedRows.filter((r) => r._status === 'error').length;

    res.json({
      totalRows: transformedRows.length,
      validRows,
      warningRows,
      errorRows,
      duplicateCount: duplicates.length,
      warnings: warnings.slice(0, 50),
      errors: errors.slice(0, 50),
      duplicates: duplicates.slice(0, 50),
      preview: transformedRows.slice(0, 10).map(({ _status, _row, ...fields }) => ({
        ...fields,
        _status,
        _row,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /import/execute ────────────────────────────────────────────────────

const CONTACT_FIELDS = [
  'phone_number', 'first_name', 'last_name', 'email', 'company', 'notes',
  'address_street', 'address_city', 'address_state', 'address_postal_code', 'address_country',
];

router.post('/import/execute', requirePermission('contacts', 'create'), async (req, res, next) => {
  try {
    const { sessionId, mappings, settings } = req.body as {
      sessionId: string;
      mappings: Record<string, string>;
      settings: { duplicateHandling: string; listId?: string; defaultTags?: string[] };
    };

    const session = importSessions.get(sessionId);
    if (!session || session.companyId !== req.companyId!) {
      res.status(404).json({ error: 'Import session not found or expired' });
      return;
    }

    const companyId = session.companyId;
    const userId = session.userId;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const importErrors: { row: number; message: string }[] = [];
    const allNewContactIds: string[] = [];

    // Process in batches of 50
    const BATCH_SIZE = 50;
    for (let batchStart = 0; batchStart < session.rows.length; batchStart += BATCH_SIZE) {
      const batchRows = session.rows.slice(batchStart, batchStart + BATCH_SIZE);

      // Transform rows using mappings
      const transformedBatch: {
        rowNum: number;
        contactData: Record<string, unknown>;
        customFields: { defId: string; value: string }[];
        tags: string[];
      }[] = [];

      for (let i = 0; i < batchRows.length; i++) {
        const row = batchRows[i];
        const rowNum = batchStart + i + 2; // +2 for 1-indexed + header row
        const contactData: Record<string, unknown> = {};
        const customFields: { defId: string; value: string }[] = [];
        let tags: string[] = [...(settings.defaultTags || [])];

        for (const [sourceHeader, destField] of Object.entries(mappings)) {
          if (!destField || destField === 'skip') continue;
          const val = row[sourceHeader]?.trim() || '';
          if (!val) continue;

          if (destField === 'tags') {
            const parsed = val.split(',').map((t: string) => t.trim()).filter(Boolean);
            tags = [...tags, ...parsed];
          } else if (destField.startsWith('custom:')) {
            customFields.push({ defId: destField.slice(7), value: val });
          } else if (CONTACT_FIELDS.includes(destField)) {
            contactData[destField] = val;
          }
        }

        // Validate phone
        const rawPhone = String(contactData.phone_number || '');
        if (!rawPhone) {
          importErrors.push({ row: rowNum, message: 'Missing phone number' });
          continue;
        }

        const phoneResult = validateAndFormatPhone(rawPhone);
        if ('error' in phoneResult) {
          importErrors.push({ row: rowNum, message: phoneResult.error });
          continue;
        }
        contactData.phone_number = phoneResult.e164;

        // Deduplicate tags
        tags = [...new Set(tags)];

        transformedBatch.push({ rowNum, contactData, customFields, tags });
      }

      if (transformedBatch.length === 0) continue;

      // Check for existing contacts in this batch
      const batchPhones = transformedBatch.map((r) => String(r.contactData.phone_number));
      const { data: existingContacts } = await supabaseAdmin
        .from('contacts')
        .select('id, phone_number, first_name, last_name, email, company, notes, tags, address_street, address_city, address_state, address_postal_code, address_country')
        .eq('company_id', companyId)
        .eq('is_deleted', false)
        .in('phone_number', batchPhones);

      const existingMap = new Map(
        (existingContacts || []).map((c) => [c.phone_number, c]),
      );

      const toInsert: Record<string, unknown>[] = [];
      const toUpdate: { id: string; data: Record<string, unknown> }[] = [];
      const customFieldRows: { contactPhone: string; fields: { defId: string; value: string }[] }[] = [];

      for (const { rowNum, contactData, customFields, tags } of transformedBatch) {
        const phone = String(contactData.phone_number);
        const existing = existingMap.get(phone);

        if (existing) {
          if (settings.duplicateHandling === 'skip') {
            skipped++;
            continue;
          }

          if (settings.duplicateHandling === 'overwrite') {
            // Replace all fields
            const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
            for (const field of CONTACT_FIELDS) {
              if (field === 'phone_number') continue;
              if (contactData[field] !== undefined) updateData[field] = contactData[field];
            }
            if (tags.length > 0) {
              updateData.tags = [...new Set([...(existing.tags || []), ...tags])];
            }
            toUpdate.push({ id: existing.id, data: updateData });
            updated++;
          } else if (settings.duplicateHandling === 'merge') {
            // Only fill empty fields
            const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
            let hasChanges = false;
            for (const field of CONTACT_FIELDS) {
              if (field === 'phone_number') continue;
              if (!existing[field as keyof typeof existing] && contactData[field]) {
                updateData[field] = contactData[field];
                hasChanges = true;
              }
            }
            if (tags.length > 0) {
              updateData.tags = [...new Set([...(existing.tags || []), ...tags])];
              hasChanges = true;
            }
            if (hasChanges) {
              toUpdate.push({ id: existing.id, data: updateData });
              updated++;
            } else {
              skipped++;
            }
          }

          if (customFields.length > 0 && settings.duplicateHandling !== 'skip') {
            customFieldRows.push({ contactPhone: phone, fields: customFields });
          }
        } else {
          toInsert.push({
            company_id: companyId,
            created_by: userId,
            phone_number: phone,
            first_name: contactData.first_name || null,
            last_name: contactData.last_name || null,
            email: contactData.email || null,
            company: contactData.company || null,
            notes: contactData.notes || null,
            tags,
            address_street: contactData.address_street || null,
            address_city: contactData.address_city || null,
            address_state: contactData.address_state || null,
            address_postal_code: contactData.address_postal_code || null,
            address_country: contactData.address_country || null,
          });
          if (customFields.length > 0) {
            customFieldRows.push({ contactPhone: phone, fields: customFields });
          }
        }
      }

      // Bulk insert new contacts
      if (toInsert.length > 0) {
        const { data: inserted, error } = await supabaseAdmin
          .from('contacts')
          .insert(toInsert)
          .select('id, phone_number');

        if (error) {
          // Try one by one on conflict
          for (const row of toInsert) {
            try {
              const { data: single } = await supabaseAdmin
                .from('contacts')
                .insert(row)
                .select('id, phone_number')
                .single();
              if (single) {
                created++;
                allNewContactIds.push(single.id);
              }
            } catch {
              skipped++;
            }
          }
        } else if (inserted) {
          created += inserted.length;
          allNewContactIds.push(...inserted.map((c) => c.id));

          // Build phone→id map for custom fields
          const insertedMap = new Map(inserted.map((c) => [c.phone_number, c.id]));
          for (const cfr of customFieldRows) {
            const contactId = insertedMap.get(cfr.contactPhone);
            if (contactId) {
              const cfvRows = cfr.fields.map((f) => ({
                contact_id: contactId,
                field_definition_id: f.defId,
                value: f.value,
                value_json: null,
              }));
              await supabaseAdmin
                .from('custom_field_values')
                .upsert(cfvRows, { onConflict: 'contact_id,field_definition_id' });
            }
          }
        }
      }

      // Update existing contacts
      for (const { id, data } of toUpdate) {
        await supabaseAdmin.from('contacts').update(data).eq('id', id);
      }

      // Custom fields for updated contacts
      for (const cfr of customFieldRows) {
        const existing = existingMap.get(cfr.contactPhone);
        if (existing) {
          const cfvRows = cfr.fields.map((f) => ({
            contact_id: existing.id,
            field_definition_id: f.defId,
            value: f.value,
            value_json: null,
          }));
          await supabaseAdmin
            .from('custom_field_values')
            .upsert(cfvRows, { onConflict: 'contact_id,field_definition_id' });
        }
      }
    }

    // Add to list if specified
    if (settings.listId && allNewContactIds.length > 0) {
      const memberRows = allNewContactIds.map((cid) => ({
        list_id: settings.listId,
        contact_id: cid,
        added_by: userId,
      }));
      // Insert in batches
      for (let i = 0; i < memberRows.length; i += 100) {
        await supabaseAdmin
          .from('contact_list_members')
          .upsert(memberRows.slice(i, i + 100), { onConflict: 'list_id,contact_id' });
      }
    }

    // Cleanup session
    importSessions.delete(sessionId);

    res.json({ created, updated, skipped, errors: importErrors.slice(0, 100) });
  } catch (err) {
    next(err);
  }
});

// ── GET /export ─────────────────────────────────────────────────────────────

router.get('/export', requirePermission('contacts', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const {
      search, tags, listId, company, city, country,
      createdAfter, createdBefore, contactIds,
    } = req.query;

    // Build query (same logic as GET / in contacts.ts but without pagination)
    let listContactIds: string[] | null = null;
    if (listId) {
      const { data: members } = await supabaseAdmin
        .from('contact_list_members')
        .select('contact_id')
        .eq('list_id', String(listId));
      listContactIds = (members || []).map((m) => m.contact_id);
      if (listContactIds.length === 0) {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
        res.send('');
        return;
      }
    }

    // Parse custom field filters: cf[fieldDefId]=value
    const customFieldFilters: { defId: string; value: string }[] = [];
    for (const key of Object.keys(req.query)) {
      const match = key.match(/^cf\[(.+)\]$/);
      if (match && req.query[key]) {
        customFieldFilters.push({ defId: match[1], value: String(req.query[key]) });
      }
    }

    let cfContactIds: string[] | null = null;
    if (customFieldFilters.length > 0) {
      let candidateIds: string[] | null = listContactIds;
      for (const cf of customFieldFilters) {
        let cfQuery = supabaseAdmin
          .from('custom_field_values')
          .select('contact_id')
          .eq('field_definition_id', cf.defId);
        if (candidateIds) cfQuery = cfQuery.in('contact_id', candidateIds);
        const values = cf.value.split(',').map((v) => v.trim()).filter(Boolean);
        if (values.length > 1) {
          cfQuery = cfQuery.in('value', values);
        } else {
          cfQuery = cfQuery.ilike('value', `%${values[0]}%`);
        }
        const { data: matches } = await cfQuery;
        candidateIds = (matches || []).map((m) => m.contact_id);
        if (candidateIds.length === 0) {
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
          res.send('Phone Number,First Name,Last Name,Email,Company\n');
          return;
        }
      }
      cfContactIds = candidateIds;
    }

    let query = supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_deleted', false);

    if (contactIds) {
      const ids = String(contactIds).split(',').filter(Boolean);
      if (ids.length > 0) query = query.in('id', ids);
    }

    if (cfContactIds) {
      query = query.in('id', cfContactIds);
    } else if (listContactIds) {
      query = query.in('id', listContactIds);
    }

    if (tags) {
      const tagArray = String(tags).split(',').map((t) => t.trim()).filter(Boolean);
      if (tagArray.length > 0) query = query.overlaps('tags', tagArray);
    }

    if (company) query = query.ilike('company', `%${company}%`);
    if (city) query = query.ilike('address_city', `%${city}%`);
    if (country) query = query.ilike('address_country', `%${country}%`);
    if (createdAfter) query = query.gte('created_at', String(createdAfter));
    if (createdBefore) query = query.lte('created_at', String(createdBefore));

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%,whatsapp_name.ilike.%${search}%`,
      );
    }

    query = query.order('created_at', { ascending: false });

    const { data: contacts, error } = await query;
    if (error) throw error;

    if (!contacts || contacts.length === 0) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
      res.send('Phone Number,First Name,Last Name,Email,Company\n');
      return;
    }

    // Fetch custom field definitions
    const { data: fieldDefs } = await supabaseAdmin
      .from('custom_field_definitions')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('display_order');

    // Fetch custom field values for all exported contacts
    const contactIdList = contacts.map((c) => c.id);
    const allCustomValues: Record<string, Record<string, string>> = {};

    for (let i = 0; i < contactIdList.length; i += 200) {
      const batch = contactIdList.slice(i, i + 200);
      const { data: cfvs } = await supabaseAdmin
        .from('custom_field_values')
        .select('contact_id, field_definition_id, value, value_json')
        .in('contact_id', batch);

      if (cfvs) {
        for (const cfv of cfvs) {
          if (!allCustomValues[cfv.contact_id]) allCustomValues[cfv.contact_id] = {};
          allCustomValues[cfv.contact_id][cfv.field_definition_id] =
            cfv.value || (cfv.value_json ? JSON.stringify(cfv.value_json) : '');
        }
      }
    }

    // Build flat rows for CSV
    const rows = contacts.map((c) => {
      const row: Record<string, string> = {
        'Phone Number': c.phone_number || '',
        'First Name': c.first_name || '',
        'Last Name': c.last_name || '',
        Email: c.email || '',
        Company: c.company || '',
        Notes: c.notes || '',
        Tags: (c.tags || []).join(', '),
        Street: c.address_street || '',
        City: c.address_city || '',
        State: c.address_state || '',
        'Postal Code': c.address_postal_code || '',
        Country: c.address_country || '',
      };

      // Add custom fields
      if (fieldDefs) {
        const cfValues = allCustomValues[c.id] || {};
        for (const def of fieldDefs) {
          row[def.name] = cfValues[def.id] || '';
        }
      }

      return row;
    });

    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=contacts-${date}.csv`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;
