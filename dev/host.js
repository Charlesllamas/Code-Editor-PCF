/*
 * The platform, stood in for: everything a field control reads off `context`,
 * built from a set of switches.
 *
 * Loaded by both `harness.html` in a browser and `smoke.js` in Node, which is
 * why it attaches to `window` *and* assigns `module.exports` and requires
 * neither to exist. One definition of the host is the point — a browser mock
 * and a Node mock that drifted apart would let the same control pass one and
 * fail the other for reasons that are about the mocks.
 *
 * ---
 *
 * **Why this exists when `npm start` already hosts a field control.**
 *
 * `pcf-start` gives you a property panel and a real render, and for the happy
 * path it is the better tool — use it. What it cannot put the control into is
 * every state a form can:
 *
 *   - **field-level security** — `security.readable === false` is what a user
 *     denied read access gets, and it arrives as `raw === null`, which is
 *     indistinguishable from "empty" to a control that does not check;
 *   - **platform validation** — `error` / `errorMessage`, set by a business
 *     rule the harness has no way to run;
 *   - **a host theme** — `fluentDesignLanguage.isDarkTheme`, published by a
 *     model-driven form and by nothing else;
 *   - **the canvas/model-driven split** — `attributes` is column metadata, and
 *     a canvas app has none. Every `?.` in the control is about this, and
 *     `npm start` only ever shows you one side of it.
 *
 * Those are the branches nobody exercises and customers find. Here they are
 * checkboxes.
 *
 * ---
 *
 * **A stub must never be more capable than the thing it stands in for.** Where
 * the platform withholds something, this withholds it: `security` is
 * `undefined` on a column with no field-level security, `attributes` is
 * `undefined` on canvas, `fluentDesignLanguage` is `undefined` on a host that
 * publishes no theme. Filling those in "so the control has something to read"
 * is how a control that cannot work on a real form passes every local check.
 */

(function (root, factory) {
    'use strict';

    var api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.__pcfHost = api;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    /*
     * What `context.resources.getString` answers.
     *
     * The keys are the ones in `strings/CodeEditor.1033.resx`, and a key that
     * is not here falls back to the key itself — which is what the platform
     * does for a key missing from the .resx, so a typo looks here the way it
     * looks in production rather than throwing.
     */
    var STRINGS = {
        CodeEditor_Name: 'Code Editor',
        CodeEditor_NoAccess: 'You do not have access to this field.',
    };

    /**
     * The two hosts, and the difference that matters.
     *
     * A model-driven form mounts a `FluentProvider` above every code component
     * and hands down column metadata; a canvas app does neither. Anything the
     * control reads with `?.` is reading across this line.
     */
    var HOSTS = {
        'model-driven': {
            label: 'model-driven form',
            // Published as CSS custom properties by the provider the form
            // already mounts, which is what the stylesheet reads through
            // `var()`. The control itself only needs the boolean.
            publishesTheme: true,
            // `attributes` on a bound property: MaxLength, Precision, the
            // option set for a choice column.
            publishesMetadata: true,
        },
        canvas: {
            label: 'canvas app',
            publishesTheme: false,
            publishesMetadata: false,
        },
    };

    /**
     * How the column's field-level security is configured.
     *
     * `none` is the common case and the one worth defaulting to: a column with
     * no FLS profile reports `security === undefined`, not an object with every
     * flag true. A control that reads `parameter.security.readable` without
     * guarding throws on the *ordinary* column, not on the secured one.
     */
    var SECURITY = {
        none: undefined,
        /*
         * What a real Accounts form handed down for a column with no profile
         * (2026-09-13): an object with `secured: false`, not `undefined`. Both
         * shapes are hosts, so both are here; a control reads either as
         * writable by comparing against `false`, never by reading the flag as
         * a boolean — and an optional bound property the maker never mapped
         * arrives as `{}`, which the same comparison reads correctly.
         */
        unsecured: { editable: true, readable: true, secured: false },
        'read-only': { editable: false, readable: true, secured: true },
        'no-access': { editable: false, readable: false, secured: true },
    };

    /**
     * `context.client.getFormFactor()`, which is a number and not the one most
     * people guess.
     *
     * **0 Unknown, 1 Desktop, 2 Tablet, 3 Phone.** Web is `1`, and `3` — the
     * value that looks like it ought to mean "the big one" — is a phone. A
     * control that compares against the wrong number reflows backwards, on the
     * client it was least likely to be tested on.
     *
     * This and `allocatedWidth` are the pair the platform's own guidance uses
     * together: form factor alone cannot tell a narrow container on a desktop
     * from a wide one, so responsive controls test both.
     */
    var FORM_FACTORS = { unknown: 0, desktop: 1, tablet: 2, phone: 3 };

    var DEFAULTS = {
        host: 'model-driven',
        /** One of FORM_FACTORS above, by name. */
        formFactor: 'desktop',
        /**
         * `mode.allocatedWidth` / `allocatedHeight`.
         *
         * **-1 is a real value and the default one**: the platform reports it
         * until the control asks for resize notifications with
         * `mode.trackContainerResize(true)`. A control that reads the width
         * without asking gets -1 forever and reflows to its narrowest layout on
         * every host — which is why `tracked` below records the request.
         */
        width: -1,
        height: -1,
        /** What the column holds. `null` is a cleared column. */
        value: 'Contoso Ltd',
        placeholder: 'Type a value',
        /** The maker's label for this field on this form. */
        label: 'Account name',
        visible: true,
        /** The form's read-only state. Not the column's — see `security`. */
        disabled: false,
        security: 'none',
        /** A business rule that failed. */
        error: false,
        errorMessage: 'Enter a value with at least three characters.',
        /**
         * `undefined` means the host published no theme, which is a real state
         * and the one canvas is always in. Absent is not the same as light.
         */
        dark: undefined,
        rtl: false,
        maxLength: 100,

        /**
         * What the platform hands `init()` as its third argument.
         *
         * `null` is the honest default and means "nothing was saved" — a first
         * mount, or a host that does not persist. Set it to whatever a previous
         * mount passed to `mode.setControlState` to reproduce the return half of
         * a form tab switch.
         */
        state: null,

        /**
         * Whether `mode.setControlState` succeeds.
         *
         * `false` is a host that took the call and saved nothing, which is the
         * state a control cannot see except by reading the return value.
         */
        stateWritable: true,

        /**
         * The control's own input properties, merged into `parameters`.
         *
         * The scaffolded control has only `placeholder`, and every real one
         * grows more. Pass them as raw values — `{ maxSizeKb: 512 }` — and they
         * reach the control as `{ raw: … }` where it expects them. A further
         * *bound* property goes in `bound` instead, which carries the shape a
         * mapped or an unmapped column actually arrives in.
         *
         * Passing them rather than editing this file is what keeps a repo's
         * copy of the rig close enough to the template's to update by copying.
         */
        inputs: {},

        /**
         * What `context.device.pickFile()` resolves with — an array of
         * `FileObject` — or `null` to reject.
         *
         * **`null` is the default, and that is not pessimism.** Every device
         * method rejects outside a real device origin: the hub's demo sandbox,
         * `npm start`, a canvas app in a browser tab. A control that treats the
         * rejection as an error state rather than as an ordinary outcome shows
         * a red message to most of the people who ever run it.
         *
         * Note `fileSize` is in **KB**, not bytes. It is the one field of a
         * `FileObject` that reads like it means something else, and a size
         * check written against bytes lets a file a thousand times too large
         * straight through.
         */
        pickFile: null,

        /**
         * What `context.device.captureImage()` resolves with — **one**
         * `FileObject`, not an array — or `null` to reject.
         *
         * The arity is the trap. `pickFile` resolves with `FileObject[]` and
         * this resolves with a single object, so the reflex that worked on the
         * picker (`files[0]`) reads `undefined` here and the control uploads
         * nothing, silently. Both are stubbed so that mistake is available to
         * make locally rather than on a phone.
         *
         * Rejects by default for the reason `pickFile` does, and rather more
         * strongly: there is no camera anywhere this rig runs.
         */
        captureImage: null,

        /**
         * Whether `context.device` exists at all.
         *
         * **Absence is a fourth state, and it is not a refusal.** A refusal is
         * the platform saying no; absence is the API never having been there,
         * which is what `<uses-feature required="false">` buys and what Power
         * Pages does to every `Device.*` method unconditionally. A control has
         * to say something different in each case — "not on this client" is
         * actionable on another one, "that did not work" is not — and it cannot
         * be tested for that without being able to reach both.
         */
        device: true,

        /**
         * What `context.device.getCurrentPosition()` does.
         *
         * Either an object of coordinates to resolve with —
         * `{ latitude, longitude, accuracy }`, the rest filled in — or one of
         * three **named refusals**, because the refusals are not
         * interchangeable and a control that handles one handles none:
         *
         *   'denied'      -> rejects with `{ code, message }`, a plain object.
         *                    The user, or the client, said no.
         *   'unavailable' -> rejects with **`null`**. Documented: an older
         *                    model-driven mobile client, or a device with no
         *                    geolocation capability at all, passes `null` to
         *                    the error callback and nothing else.
         *   'no-bridge'   -> rejects with an `Error`. A browser tab with no
         *                    native host: `npm start`, the hub's sandbox.
         *   'absent'      -> **the method is not on the bag at all.** Not a
         *                    rejection: `typeof device.getCurrentPosition` is
         *                    'undefined', and a control that calls it without
         *                    checking throws a TypeError rather than reaching
         *                    any catch block it wrote.
         *
         * **'no-bridge' is the default**, because it is what every host this rig
         * can imitate actually does — and because `getCurrentPosition` is
         * narrower than it looks. It is canvas apps and the model-driven
         * **mobile** client only; a model-driven form in a *browser* has no
         * location at all, which is the degradation most geo controls never
         * test because it is the one they were written on.
         *
         * `'unavailable'` is the one to write a test for first. A
         * `catch (error)` that reads `error.message` throws on `null` — so the
         * handler for the failure fails, and the control hangs on its own
         * promise instead of showing the state it has for exactly this.
         */
        position: 'no-bridge',

        /**
         * Whether `context.webAPI` exists at all.
         *
         * The same switch, and the same reasoning, as the dataset rig's: WebAPI
         * is Dataverse-dependent and **not available in canvas apps**, so a
         * control that reaches for it unguarded works everywhere it was tested
         * and nowhere else.
         */
        webAPI: true,

        /**
         * What `webAPI.createRecord` resolves with — an id — or `null` to
         * reject.
         *
         * Success is the default, unlike every device switch above, and the
         * difference is honest rather than inconsistent: a create against a
         * model-driven form's Dataverse ordinarily works, so the rejection is
         * the exception and the exception is what a caller asks for.
         */
        createRecord: '11111111-2222-3333-4444-555555555555',

        /**
         * What `webAPI.retrieveRecord` resolves with.
         *
         * `'fixture'` (the default) answers from `fixture.tables` by id,
         * honouring `$select`, and refuses an id the fixture does not hold the
         * way the server does — `Record Is Unavailable`. An object resolves
         * with that literal, which is the older shape and still the right one
         * for a control that reads one row it does not care to model. `null`
         * rejects.
         */
        retrieveRecord: 'fixture',

        /**
         * Whether `webAPI.updateRecord` resolves. `false` rejects.
         *
         * When it resolves it **applies**: the row in this host's copy of
         * `fixture.tables` takes the payload — a primitive under its key, an
         * `<nav>@odata.bind` as the lookup's `_<column>_value` with the three
         * annotations, `null` clearing either — and, where the fixture has
         * an `audit` table, the write is **audited**: a new row by
         * `userId`/`userName` with an `AttributeAuditDetail` whose old side
         * is what the row held and whose new side is the payload, so the
         * next `RetrieveRecordChangeHistory` lists it first. That is what
         * the platform does with every update, and it is how a control that
         * writes can be shown its own write on the next read. A payload
         * naming an `@odata.bind` the fixture's relationships do not declare
         * is refused with the measured "undeclared property" fault; a bind
         * value whose entity set or id the fixture does not hold is "Record
         * Is Unavailable". A column in `fixture.notUpdatable[table]` is
         * **dropped silently** — the write resolves and the row does not
         * change — because that is what the server does (measured).
         */
        updateRecord: true,

        /**
         * `userSettings.userId` and `userName` — the platform publishes
         * both (typed), and a control that writes shows them on the row it
         * wrote. Braced upper-case, as the platform sends the id.
         */
        userId: '{00000000-0000-0000-0000-0000000000AA}',
        userName: 'Rig User',

        /**
         * Every Web API method rejects with the measured fault shape — a plain
         * object carrying `errorCode`, `message`, `code`, `title` and `raw`,
         * not an `Error`. The host that is *present* and *refusing* is a
         * different state from `webAPI: false`, and a control names them
         * differently: "not available here" against "could not be read".
         */
        webApiFails: false,

        /**
         * The rows the Web API answers from — `retrieveRecord`,
         * `retrieveMultipleRecords` — and what the same-origin metadata
         * `fetch` describes. `null` means no tables: every query answers no
         * rows, every read refuses, every relationship list is empty. Pass the
         * object `dev/fixture.js` exports, or your own in that shape:
         *
         *   tables:        { account: [ { accountid, name, _parentaccountid_value,
         *                                 'revenue@OData.Community.Display.V1.FormattedValue', … } ] }
         *   hierarchy:     { account: { id: 'accountid', parent: 'parentaccountid', name: 'name' } }
         *   relationships: [ { entity, column, target, navigationProperty, hierarchical } ]
         *   entitySets:    { account: 'accounts' }
         *
         * `hierarchy` is how the rig knows which column is the parent when a
         * FetchXML query says `above` or `under`; `relationships` is what the
         * `EntityDefinitions(…)/OneToManyRelationships` fetch lists, with
         * `IsHierarchical` read off `hierarchical`.
         */
        fixture: null,

        /**
         * Overrides `hierarchical` on **every** fixture relationship when it is
         * a boolean. `false` is the table nobody flagged as hierarchical — the
         * common case on a custom table — where a hierarchical operator is
         * refused and a control has to take the other route.
         */
        hierarchical: undefined,

        /**
         * The organisation URL `page.getClientUrl()` answers with, and the
         * origin this host's `fetch` stub answers on.
         *
         * **One per mount, not one per context.** `createContext` runs on every
         * render, and a real form's URL does not change between passes — so a
         * suite's `mount()` takes one from `nextClientUrl()` and hands the same
         * string to every `createContext` for that instance. Left `null`, each
         * context takes a fresh one, which is right for a one-shot context and
         * wrong for anything that caches by URL.
         */
        clientUrl: null,

        /**
         * Whether `context.page` exists. Undocumented and untyped like
         * `contextInfo`, but present on a model-driven form, where its
         * `getClientUrl()` is the honest way to reach `/api/data` on an
         * on-premises organisation whose URL carries the organisation in the
         * path. Absent on canvas whatever this says.
         */
        page: true,

        /**
         * What the metadata `fetch` of `…/ManyToOneRelationships` and
         * `…/OneToManyRelationships` answers: the HTTP status, with `200`
         * listing `fixture.relationships`, any other status a refusal body, and
         * **`0` a network failure** — the promise rejects with a `TypeError`,
         * which is what an offline client or a blocked origin does and what a
         * control's `.catch` has to read as "take the other route", not as an
         * error to show.
         */
        relationshipsStatus: 200,

        /**
         * What the table-definition reads answer, as the HTTP status — the
         * table list (`EntityDefinitions?$select=…&$filter=…`), a table's
         * columns (`…/Attributes`), its relationships in one `$expand`, and a
         * choice's options through a cast segment
         * (`…/Attributes(LogicalName='x')/Microsoft.Dynamics.CRM.
         * PicklistAttributeMetadata?…`). `200` answers from
         * `fixture.metadata` in the shapes a form returned (pcf-code-editor
         * SPEC.md, the 1.4.9 probe, 2026-10-01); any other status is a refusal
         * body, and **`0` rejects with a `TypeError`**, the offline shape. What
         * a user without customizer rights is answered is unmeasured.
         */
        metadataStatus: 200,

        /**
         * `userSettings.languageId`, and the language a metadata Label's
         * `UserLocalizedLabel` is in. 1033 unless a suite says otherwise.
         */
        languageId: 1033,

        /**
         * What a same-origin `fetch` of `<clientUrl>/WebResources/<name>`
         * answers — the route a control takes to read its configuration out
         * of a web resource, which needs no `<uses-feature>`. `null` answers
         * from `fixture.webResources`, the way a form did (pcf-code-editor
         * SPEC.md P1–P2b, 2026-09-23): **200 `text/jscript`** for a Script
         * web resource, whatever its name ends in, because Dataverse has no
         * JSON type; **404 with an empty body** for a name that is not there,
         * so a control can only go on the status. Any other number is that
         * status with an empty body — `403` for a resource the user cannot
         * read — and **`0` rejects with a `TypeError`**, the offline shape.
         */
        webResourceStatus: null,

        /**
         * What the two audit **functions** answer on the `fetch` stub —
         * `audits(<id>)/Microsoft.Dynamics.CRM.RetrieveAuditDetails` (bound to
         * the audit row) and `RetrieveRecordChangeHistory(Target=@t,
         * PagingInfo=@p)` (unbound, its arguments as `@`-aliases in the query
         * string) — as the HTTP status. `200` answers from `fixture.audits`;
         * `403` is the refusal a user without `prvReadRecordAuditHistory`
         * gets, a body with `error.code` and `error.message`; **`0` rejects
         * with a `TypeError`**, the offline shape. Neither function is
         * reachable through `context.webAPI`, which has no `execute` — that is
         * the whole reason a control fetches them.
         */
        auditStatus: 200,

        /**
         * Whether `retrieveMultipleRecords('audit', …)` answers. `false` is
         * the user without `prvReadAuditSummary`: the query rejects in the
         * fault shape while the functions above may still answer, because the
         * two privileges are separate and a control degrades on each on its
         * own — rows without values, or values nobody can list.
         */
        auditSummary: true,

        /**
         * Whether auditing is on, at the two levels a control can ask about:
         * `org` is what `retrieveMultipleRecords('organization',
         * '?$select=isauditenabled')` answers when the fixture holds no
         * `organization` table, and `table` is `IsAuditEnabled.Value` on the
         * `EntityDefinitions(LogicalName='x')?$select=IsAuditEnabled` fetch.
         * Both are `BooleanManagedProperty`-shaped on the wire — `{ Value,
         * CanBeChanged, ManagedPropertyLogicalName }` — never a bare boolean.
         */
        auditEnabled: { org: true, table: true },

        /**
         * What `navigation.openForm` does — model-driven only, so absent on
         * canvas whatever this says.
         *
         *   'resolves' -> resolves `{ savedEntityReference: null }`, which is
         *                 what a form the user simply navigated to reports
         *   'rejects'  -> rejects with the fault shape
         *   'absent'   -> the method is not on the bag
         */
        openForm: 'resolves',

        /**
         * Whether `context.utils` exists, and the entity set its metadata
         * answers with.
         *
         * `getEntityMetadata` is **model-driven only** and gated behind the
         * `Utility` feature, so absence is a real host. See `utils` in the
         * context below for the shape it answers with, which is not the shape
         * it looks like.
         */
        utils: true,
        entitySetName: 'accounts',
        /** What `getEntityMetadata(…).PrimaryNameAttribute` answers. */
        primaryNameAttribute: 'name',

        /**
         * The bound property's type, and — for a lookup — its target table and
         * whether the two lookup methods are there.
         *
         * A `Lookup.Simple` binding is an array in both directions and carries
         * `getTargetEntityType()` and `getViewId()`, which no manifest attribute
         * and no other property type has. `targetMethod` reproduces the three
         * states a control has to survive: `'present'`, `'absent'` (the hub's
         * harness builds a bag with no methods on it) and `'throws'`.
         * `column` is what `attributes.LogicalName` answers — the one thing a
         * control has to read to filter children on the right column.
         */
        valueType: 'SingleLine.Text',
        column: 'name',
        target: 'account',
        targetMethod: 'present',

        /**
         * Bound properties beyond the first, by manifest name — a second
         * column the maker maps in the configuration pane, such as the parent
         * a cascading lookup is filtered by.
         *
         *   { parentValue: 'unmapped' }
         *   { parentValue: { type: 'Lookup.Simple', raw: [ { id, name, entityType } ],
         *                    target: 'account', column: 'parentcustomerid' } }
         *
         * **`'unmapped'` is the measured eight-key shape** of an optional
         * bound property the maker left empty (pcf-address-autocomplete-azure,
         * Accounts form, 2026-09-13): `type: null`, `raw: null`,
         * `attributes: {}`, `security: {}`. `type === null` is the tell, and a
         * control that reads `raw` without it takes an unmapped picker for an
         * empty column. A mapped `Lookup.Simple` carries the two lookup
         * methods, subject to `targetMethod` like the first; `raw` of an empty
         * mapped lookup is `[]`, never `null`.
         */
        bound: {},

        /**
         * Whether `utils.lookupObjects` exists while `utils` itself does. A
         * host can withhold the dialog on its own, so a control detects the
         * method and not the bag.
         */
        lookupObjects: true,

        /**
         * What `utils.lookupObjects` resolves with. Measured 2026-09-11: a
         * pick is `[{ id: "{8FE84297-…}", entityType, name }]` — an array,
         * GUID **braced and upper-case**, the opposite of what a lookup's
         * `raw` carries — and a **cancel resolves `[]`**, not `undefined` and
         * not a rejection. The default is the cancel, because that is the
         * branch a control forgets. Pass `{ id, entityType, name }` for a
         * pick; the rig braces and upper-cases the id itself. The same two
         * switches as the dataset rig.
         */
        lookupPick: null,

        /**
         * What `utils.hasEntityPrivilege` answers.
         *
         * **Synchronous, and a boolean rather than a promise** — the one member
         * of `context.utils` that is. It answers about the *user's roles*, not
         * about the host, so `false` is an ordinary answer and not a failure:
         * a control that gates an affordance on it has a branch that only a
         * differently-privileged user ever reaches, which is exactly the branch
         * nobody tests.
         *
         * It lives under `utils`, so `utils: false` removes it along with
         * everything else — which is the host distinction that matters, since
         * "the user may not" and "this host cannot say" call for different
         * behaviour and a control that conflates them hides itself in canvas.
         */
        hasPrivilege: true,

        /**
         * Whether the manifest declares `<uses-feature name="Utility">`.
         * `hasEntityPrivilege` is published either way and **throws** when
         * it is not — measured 2026-09-25 (pcf-row-commands P1). The rig
         * cannot read the manifest; a suite passes what it says.
         */
        utilityDeclared: true,

        /**
         * Whether `context.navigation` exists at all.
         *
         * Typed non-optional, which is a claim about the type definitions
         * rather than about the host. A control that reads
         * `context.navigation.openConfirmDialog` through an unguarded bag
         * throws a TypeError rather than degrading, and a rig that cannot
         * remove the bag cannot tell the two apart.
         */
        hasNavigation: true,

        /**
         * What the platform dialogs do, and there are four answers rather than
         * two.
         *
         *   'confirmed' -> `openConfirmDialog` resolves `{ confirmed: true }`
         *   'cancelled' -> resolves `{ confirmed: false }` — **a resolve, not a
         *                  reject.** A control that treats a cancel as a
         *                  failure reports an error the user did not cause,
         *                  and this is the single easiest thing to get wrong
         *                  about the dialog API.
         *   'rejected'  -> the promise rejects, which is what a dialog the host
         *                  refuses to open does
         *   'absent'    -> the three dialog methods are **deleted from the
         *                  bag**, which is what canvas is. Absence is a
         *                  different state from refusal, and only one of the
         *                  two is ever a bug in the control.
         *
         * The same four answers as the dataset rig's, deliberately: an
         * assertion about a confirmation should read identically in both.
         */
        dialogs: 'confirmed',

        /**
         * `context.mode.contextInfo`, or `null` for a host without it.
         *
         * **`null` is the default, and this member is the reason.** It is
         * absent from `@types/powerapps-component-framework` altogether, so
         * every use of it is an untyped cast; and the platform's own FAQ says
         * code components deliberately do *not* carry the record's identity,
         * pointing at bound `entityId` / `entityName` input properties instead.
         * Defaulting it to absent puts the documented fallback under test rather
         * than the undocumented happy path.
         *
         * Set it to `{ entityId, entityTypeName }` to get the other branch.
         */
        contextInfo: null,

        /** `context.client.isOffline()`. A phone out in a field is this one. */
        offline: false,

        /**
         * What `context.resources.getResource()` hands to its success callback,
         * or `null` to call the failure callback instead.
         *
         * `null` by default for the same reason: an `<img>` resource resolves
         * on a model-driven form and is not something to count on elsewhere, so
         * a control whose empty state depends on one has no empty state on the
         * hosts that matter most for a demo.
         */
        resource: null,
    };

    /*
     * One `fetch` stub for every host this file ever builds, routed by origin.
     *
     * Installed per host, the stub belonged to whichever host a suite created
     * *last* — the dataset rig learned that from a suite that bound five views
     * and dropped a file on the first. So each host registers its origin here
     * and a single global dispatches on the URL's prefix, falling through to
     * whatever `fetch` was there before for anything on no rig origin.
     */
    var hostsByUrl = {};
    var hostCount = 0;

    /*
     * The fixture is shared by every host a suite creates, and a write that
     * mutated it leaked into every later host — `pcf-kanban-board` 0.3.0
     * saw seven assertions fail that way. So each host works on its own
     * copy, made once per organisation URL: the tables' rows one level deep
     * (a row is replaced, never mutated in place, so the shared row objects
     * are never touched), the audit details by reference (the write adds
     * keys, it does not change existing ones). Everything else is read only
     * and shared as it is.
     */
    var fixturesByUrl = {};

    function fixtureFor(clientUrl, base) {
        if (!base) {
            return base;
        }

        if (!fixturesByUrl[clientUrl]) {
            var copy = Object.assign({}, base, { tables: {}, audits: Object.assign({}, base.audits, { details: Object.assign({}, (base.audits || {}).details) }) });

            Object.keys(base.tables || {}).forEach(function (table) {
                copy.tables[table] = base.tables[table].map(function (row) { return Object.assign({}, row); });
            });

            fixturesByUrl[clientUrl] = copy;
        }

        return fixturesByUrl[clientUrl];
    }

    function clientUrlFor(index) {
        return 'https://rig' + (index === 1 ? '' : index) + '.crm.invalid';
    }

    /** A fresh organisation URL — one per mount. See `clientUrl` in DEFAULTS. */
    function nextClientUrl() {
        return clientUrlFor((hostCount += 1));
    }

    /**
     * A `webAPI` rejection in the measured shape: `{ errorCode, message, code,
     * title, raw }`, a plain object and **not an `Error`**. The same function
     * as the dataset rig's, so an assertion reads the same in both.
     */
    function webApiFault(code, title, message) {
        return {
            errorCode: code,
            message: message,
            code: code,
            title: title,
            raw: JSON.stringify({ errorCode: code, message: message, title: title }),
        };
    }

    function reply(status, body) {
        return Promise.resolve({
            ok: status >= 200 && status < 300,
            status: status,
            json: function () {
                return Promise.resolve(body);
            },
            text: function () {
                return Promise.resolve(JSON.stringify(body));
            },
        });
    }

    /* ------------------------------------------------- table definitions */

    /*
     * What the table-definition reads answer, from `fixture.metadata` — the
     * shapes measured on a form by pcf-code-editor's 1.4.9 probe (its SPEC.md,
     * 2026-10-01). The rules the answers keep, because a control that reads
     * them leans on each:
     *
     *   - Only what `$select` names comes back, beside `MetadataId` — so a
     *     control that reads a property it did not ask for gets `undefined`
     *     here, as it would on a form.
     *   - A Label is `{ LocalizedLabels, UserLocalizedLabel }`;
     *     `LabelLanguages=<lcid>` narrows `LocalizedLabels` to that language,
     *     and `UserLocalizedLabel` is the label in `languageId`, or `null`
     *     where there is none — 86 of 860 tables and every shadow column had
     *     none on the form.
     *   - A shadow column (`AttributeOf` set — `accountcategorycodename`) has
     *     no label, is `IsLogical`, and FetchXML takes it; a column not valid
     *     for read is listed and refused by a query (`0x80041a08`).
     */

    /** `a=1&b=2` → `{ a: '1', b: '2' }`, decoded — a control may encode or not. */
    function queryOf(search) {
        var out = {};

        String(search || '').split('&').forEach(function (pair) {
            var eq = pair.indexOf('=');

            if (eq > 0) {
                var value = pair.slice(eq + 1);

                try {
                    value = decodeURIComponent(value);
                } catch (e) {
                    // A literal % that was never encoded.
                }
                out[pair.slice(0, eq)] = value;
            }
        });

        return out;
    }

    /** The `metadataStatus` switch, around an answer built only when it is 200. */
    function metadataReply(o, build) {
        var status = o.metadataStatus;

        if (status === 0) {
            return Promise.reject(new TypeError('Failed to fetch'));
        }
        if (status !== 200) {
            return reply(status, { error: { code: '0x80040220', message: 'Refused by the rig (metadataStatus ' + status + ').' } });
        }

        var answer = build();

        return reply(answer.status, answer.body);
    }

    /** A stable GUID-shaped id from a seed, so two reads of one thing agree. */
    function metadataId(seed) {
        var hash = 0;
        var text = String(seed);

        for (var i = 0; i < text.length; i++) {
            hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
        }

        var hex = ('00000000' + hash.toString(16)).slice(-8);

        return hex + '-0000-4000-8000-' + ('000000000000' + (text.length * 7919).toString(16)).slice(-12);
    }

    /**
     * A Label from the fixture's text: a string is the 1033 label, an object
     * maps language codes to labels, `null` is no label at all.
     */
    function labelOf(text, o, query) {
        var map = text === null || text === undefined ? {} : typeof text === 'string' ? { 1033: text } : text;
        var only = query && query.LabelLanguages ? Number(query.LabelLanguages) : null;
        var labels = Object.keys(map)
            .map(Number)
            .filter(function (code) { return only === null || code === only; })
            .map(function (code) {
                return { Label: map[code], LanguageCode: code, IsManaged: true, MetadataId: metadataId('label:' + code + ':' + map[code]), HasChanged: null };
            });

        return {
            LocalizedLabels: labels,
            UserLocalizedLabel: labels.filter(function (label) { return label.LanguageCode === o.languageId; })[0] || null,
        };
    }

    /** A row narrowed to what `$select` named — the server's rule. */
    function pick(row, select) {
        if (!select) {
            return row;
        }

        var out = {};

        ['@odata.type', 'MetadataId'].concat(select).forEach(function (key) {
            if (row[key] !== undefined) {
                out[key] = row[key];
            }
        });

        return out;
    }

    function selectOf(query) {
        return query && query.$select ? query.$select.split(',').map(function (s) { return s.trim(); }) : null;
    }

    function metadataTable(fixture, name) {
        return ((fixture.metadata || {}).tables || {})[name];
    }

    function primaryIdOf(fixture, name) {
        var table = metadataTable(fixture, name);

        if (table && table.primaryId) {
            return table.primaryId;
        }

        var hierarchy = (fixture.hierarchy || {})[name];

        return hierarchy && hierarchy.id ? hierarchy.id : name + 'id';
    }

    /** An intersect table is not valid for Advanced Find (1.4.9 P1: 0 of 689). */
    function advancedFindOf(table) {
        return table.advancedFind !== undefined ? Boolean(table.advancedFind) : !table.intersect;
    }

    function tableListAnswer(fixture, o, query) {
        var tables = (fixture.metadata || {}).tables || {};
        var filter = (query.$filter || '').trim();
        var tests = {
            '': function () { return true; },
            'IsPrivate eq false': function (table) { return !table.private; },
            'IsValidForAdvancedFind eq true': advancedFindOf,
        };

        if (!tests[filter]) {
            return { status: 400, body: { error: { code: '0x80060888', message: 'The rig answers $filter=IsPrivate eq false or IsValidForAdvancedFind eq true, not: ' + filter } } };
        }

        var select = selectOf(query);

        return {
            status: 200,
            body: {
                value: Object.keys(tables).sort().filter(function (name) { return tests[filter](tables[name]); }).map(function (name) {
                    var table = tables[name];

                    return pick({
                        MetadataId: metadataId('table:' + name),
                        LogicalName: name,
                        DisplayName: labelOf(table.label, o, query),
                        EntitySetName: table.entitySet,
                        PrimaryIdAttribute: primaryIdOf(fixture, name),
                        PrimaryNameAttribute: table.primaryName === undefined ? null : table.primaryName,
                        IsIntersect: Boolean(table.intersect),
                        IsValidForAdvancedFind: advancedFindOf(table),
                        IsPrivate: Boolean(table.private),
                    }, select);
                }),
            },
        };
    }

    /**
     * A table's columns: `fixture.metadata`'s, then every name only
     * `fixture.labels` or `fixture.notUpdatable` knows — the older fixtures'
     * columns, typed by their name as the rig always typed them.
     */
    function columnsOf(fixture, entity) {
        var table = metadataTable(fixture, entity);
        var columns = (table && table.columns ? table.columns : []).slice();
        var known = columns.map(function (column) { return column.name; });
        var labelled = (fixture.labels || {})[entity] || {};
        var legacy = Object.keys(labelled).concat((fixture.notUpdatable || {})[entity] || []);

        legacy.forEach(function (name) {
            if (known.indexOf(name) === -1) {
                known.push(name);
                columns.push({
                    name: name,
                    type: /_composite$/.test(name) ? 'Memo' : /^_|_value$|id$/.test(name) ? 'Lookup' : 'String',
                    label: labelled[name] === undefined ? null : labelled[name],
                    legacy: true,
                });
            }
        });

        return columns;
    }

    /** `MultiSelectPicklistType` is `Virtual` underneath; every other kind is its `AttributeType`. */
    function kindOf(column) {
        return column.typeName === 'MultiSelectPicklistType' ? 'MultiSelectPicklist' : column.type;
    }

    function attributesAnswer(fixture, o, entity, query) {
        var columns = columnsOf(fixture, entity);

        if (columns.length === 0) {
            return { status: 404, body: { error: { code: '0x80060888', message: "Could not find a property named '" + entity + "'." } } };
        }

        var frozen = (fixture.notUpdatable || {})[entity] || [];
        var select = selectOf(query);

        return {
            status: 200,
            body: {
                value: columns.map(function (column) {
                    return pick({
                        '@odata.type': '#Microsoft.Dynamics.CRM.AttributeMetadata',
                        MetadataId: metadataId('column:' + entity + '.' + column.name),
                        LogicalName: column.name,
                        AttributeType: column.type,
                        AttributeTypeName: { Value: column.typeName || column.type + 'Type' },
                        DisplayName: labelOf(column.label, o, query),
                        Description: labelOf(column.description, o, query),
                        IsValidForRead: column.readable !== false,
                        IsValidForUpdate: frozen.indexOf(column.name) === -1 && column.updatable !== false,
                        AttributeOf: column.of || null,
                        IsLogical: Boolean(column.logical || column.of),
                    }, select);
                }),
            },
        };
    }

    /**
     * The relationships a table takes part in, from `fixture.relationships`
     * (`one`: rows pointing at it; `many`: its own lookups) and
     * `fixture.metadata.manyToMany` (`both`).
     */
    function relationshipRows(fixture, o, entity, direction) {
        if (direction === 'both') {
            return ((fixture.metadata || {}).manyToMany || [])
                .filter(function (row) { return row.entity1 === entity || row.entity2 === entity; })
                .map(function (row) {
                    return {
                        MetadataId: metadataId('m2m:' + row.schemaName),
                        SchemaName: row.schemaName,
                        Entity1LogicalName: row.entity1,
                        Entity2LogicalName: row.entity2,
                        IntersectEntityName: row.intersect,
                        Entity1IntersectAttribute: row.attribute1,
                        Entity2IntersectAttribute: row.attribute2,
                    };
                });
        }

        return (fixture.relationships || [])
            .filter(function (row) {
                return direction === 'one' ? row.target === entity : row.entity === entity;
            })
            .map(function (row) {
                return {
                    MetadataId: metadataId('rel:' + (row.schemaName || row.entity + '_' + row.column)),
                    SchemaName: row.schemaName || (row.entity + '_' + row.column),
                    ReferencingAttribute: row.column,
                    ReferencingEntity: row.entity,
                    ReferencedEntity: row.target,
                    ReferencedAttribute: primaryIdOf(fixture, row.target),
                    ReferencingEntityNavigationPropertyName: row.navigationProperty,
                    IsHierarchical: typeof o.hierarchical === 'boolean'
                        ? (o.hierarchical && row.entity === row.target)
                        : Boolean(row.hierarchical),
                };
            });
    }

    /** `A($select=x,y),B($select=z)` → `[{ name: 'A', query: { $select: 'x,y' } }, …]`. */
    function expandItems(expand) {
        var items = [];
        var depth = 0;
        var start = 0;

        for (var i = 0; i <= expand.length; i++) {
            var c = expand.charAt(i);

            if (c === '(') {
                depth++;
            } else if (c === ')') {
                depth--;
            } else if ((c === ',' && depth === 0) || i === expand.length) {
                var item = expand.slice(start, i).trim();
                var open = item.indexOf('(');

                if (item !== '') {
                    items.push({
                        name: open === -1 ? item : item.slice(0, open),
                        query: open === -1 ? {} : queryOf(item.slice(open + 1, item.lastIndexOf(')')).replace(/;/g, '&')),
                    });
                }
                start = i + 1;
            }
        }

        return items;
    }

    function expandAnswer(fixture, o, entity, query) {
        if (!metadataTable(fixture, entity) && !(fixture.entitySets || {})[entity]) {
            return { status: 404, body: { error: { code: '0x80060888', message: "Could not find a property named '" + entity + "'." } } };
        }

        var kinds = { ManyToOneRelationships: 'many', OneToManyRelationships: 'one', ManyToManyRelationships: 'both' };
        var table = metadataTable(fixture, entity) || {};
        var body = pick({
            MetadataId: metadataId('table:' + entity),
            LogicalName: entity,
            EntitySetName: table.entitySet || (fixture.entitySets || {})[entity],
            PrimaryIdAttribute: primaryIdOf(fixture, entity),
            PrimaryNameAttribute: table.primaryName === undefined ? null : table.primaryName,
        }, selectOf(query));
        var items = expandItems(query.$expand);

        for (var i = 0; i < items.length; i++) {
            if (!kinds[items[i].name]) {
                return { status: 400, body: { error: { code: '0x80060888', message: "The rig expands the three relationship kinds, not '" + items[i].name + "'." } } };
            }
            body[items[i].name] = relationshipRows(fixture, o, entity, kinds[items[i].name]).map(function (row) {
                return pick(row, selectOf(items[i].query));
            });
        }

        return { status: 200, body: body };
    }

    /** One option in the shape a form gave it — State and Status options carry more. */
    function optionRow(entity, column, kind, option, o, query) {
        var extra = option[2] || {};
        var row = {
            Color: extra.Color === undefined ? null : extra.Color,
            Description: labelOf(null, o, query),
            ExternalValue: null,
            HasChanged: null,
            IsHidden: false,
            IsManaged: true,
            Label: labelOf(option[1], o, query),
            MetadataId: metadataId('option:' + entity + '.' + column.name + '.' + option[0]),
            ParentValues: [],
            Tag: null,
            Value: option[0],
        };

        if (kind === 'State') {
            row['@odata.type'] = '#Microsoft.Dynamics.CRM.StateOptionMetadata';
            row.DefaultStatus = extra.DefaultStatus;
            row.InvariantName = extra.InvariantName || option[1];
        }
        if (kind === 'Status') {
            row['@odata.type'] = '#Microsoft.Dynamics.CRM.StatusOptionMetadata';
            row.State = extra.State;
            row.TransitionData = null;
        }

        return row;
    }

    /**
     * A choice's options. A Yes/No answers `TrueOption`/`FalseOption` — its
     * fixture lists the true option first — and every other kind `Options`.
     * A cast that is not the column's kind is answered 404; what the server
     * says to one is unmeasured.
     */
    function optionsAnswer(fixture, o, entity, name, cast, query) {
        var column = columnsOf(fixture, entity).filter(function (c) { return c.name === name; })[0];

        if (!column || kindOf(column) !== cast) {
            return { status: 404, body: { error: { code: '0x80060888', message: "Could not find an attribute named '" + name + "' of type " + cast + '.' } } };
        }

        var options = column.options || [];
        var expand = query.$expand || '';
        var body = { MetadataId: metadataId('column:' + entity + '.' + name), LogicalName: name };

        if (/\bOptionSet\b/.test(expand.replace(/GlobalOptionSet/g, ''))) {
            body.OptionSet = cast === 'Boolean'
                ? {
                    TrueOption: options[0] ? optionRow(entity, column, cast, options[0], o, query) : null,
                    FalseOption: options[1] ? optionRow(entity, column, cast, options[1], o, query) : null,
                }
                : { Options: options.map(function (option) { return optionRow(entity, column, cast, option, o, query); }) };
        }
        if (/\bGlobalOptionSet\b/.test(expand)) {
            body.GlobalOptionSet = null;
        }

        return { status: 200, body: body };
    }

    /**
     * A web resource, as a form served one: its body as text, not JSON — the
     * control decides what the text is — and the content type a real
     * response carried. `fixture.webResources[name]` is the text, or
     * `{ content, contentType }` for a type other than Script.
     */
    function webResourceReply(o, fixture, path) {
        var name = path.split('?')[0].split('/').map(function (segment) {
            return decodeURIComponent(segment);
        }).join('/');
        var status = o.webResourceStatus;

        if (status === 0) {
            return Promise.reject(new TypeError('Failed to fetch'));
        }

        var entry = (fixture.webResources || {})[name];

        if (status === null || status === undefined) {
            status = entry === undefined ? 404 : 200;
        }

        var found = status === 200 && entry !== undefined;
        var content = found ? (typeof entry === 'string' ? entry : entry.content) : '';
        var contentType = found
            ? (typeof entry === 'string' ? 'text/jscript' : entry.contentType || 'text/jscript')
            : 'text/html; charset=utf-8';

        return Promise.resolve({
            ok: status >= 200 && status < 300,
            status: status,
            headers: {
                get: function (header) {
                    return String(header).toLowerCase() === 'content-type' ? contentType : null;
                },
            },
            text: function () {
                return Promise.resolve(content);
            },
            json: function () {
                return new Promise(function (resolve) {
                    resolve(JSON.parse(content));
                });
            },
        });
    }

    function bareId(value) {
        return value === null || value === undefined ? value : String(value).replace(/[{}]/g, '').toLowerCase();
    }

    /**
     * `fixture.hierarchy[entity]`, or a guess from the table name — `accountid`
     * — so a fixture that names no hierarchy still answers a plain query.
     */
    function hierarchyOf(fixture, entity) {
        var declared = fixture && fixture.hierarchy ? fixture.hierarchy[entity] : undefined;

        return {
            id: (declared && declared.id) || entity + 'id',
            parent: declared ? declared.parent : undefined,
            name: (declared && declared.name) || 'name',
        };
    }

    var FORMATTED = '@OData.Community.Display.V1.FormattedValue';
    var LOOKUP_NAME = '@Microsoft.Dynamics.CRM.lookuplogicalname';
    var NAVIGATION = '@Microsoft.Dynamics.CRM.associatednavigationproperty';

    /** The measured payload fault for an `@odata.bind` the server does not know (pcf-data-table 0.5.0). */
    function undeclaredProperty(name) {
        return webApiFault(2147781913, '',
            "Error identified in Payload provided by the user for Entity :'', For more information on this error please follow this help link https://go.microsoft.com/fwlink/?linkid=2195293 ----> InnerException : Microsoft.OData.ODataException: An undeclared property '"
            + name + "' which only has property annotations in the payload but no property value was found in the payload. In OData, only declared navigation properties and declared named streams can be represented as properties without values.");
    }

    var writeCount = 0;

    /**
     * Apply an `updateRecord` payload to this host's row and audit it — see
     * `updateRecord` in DEFAULTS for what is applied and what is refused.
     * The row is replaced in the table rather than mutated, so the shared
     * fixture's row objects are never touched.
     */
    function applyUpdate(fixture, entityType, id, data, o) {
        var tables = fixture.tables;
        var h = hierarchyOf(fixture, entityType);
        var rows = tables[entityType];
        var index = -1;

        rows.forEach(function (candidate, i) {
            if (index === -1 && bareId(candidate[h.id]) === bareId(id)) {
                index = i;
            }
        });

        if (index === -1) {
            return { failure: webApiFault(2147746327, 'Record Is Unavailable', 'The requested record was not found.') };
        }

        var before = rows[index];
        var after = Object.assign({}, before);
        var oldBag = { '@odata.type': '#Microsoft.Dynamics.CRM.' + entityType };
        var newBag = { '@odata.type': '#Microsoft.Dynamics.CRM.' + entityType };
        var failure = null;

        function carry(bag, row, key) {
            [key, key + FORMATTED, key + LOOKUP_NAME, key + NAVIGATION].forEach(function (name) {
                if (row[name] !== undefined) {
                    bag[name] = row[name];
                }
            });
        }

        Object.keys(data).forEach(function (key) {
            if (failure) {
                return;
            }

            var bind = key.match(/^(.+)@odata\.bind$/);

            /*
             * A column the metadata marks IsValidForUpdate: false is not
             * refused — the server resolves and changes nothing (measured on
             * address1_composite and createdon, pcf-audit-history R9). So
             * the key is dropped here without a word, which is exactly the
             * trap a control has to read the metadata to avoid.
             */
            if (!bind && ((fixture.notUpdatable || {})[entityType] || []).indexOf(key) !== -1) {
                return;
            }

            if (!bind) {
                carry(oldBag, before, key);
                after[key] = data[key];
                delete after[key + FORMATTED];
                newBag[key] = data[key];

                return;
            }

            var nav = bind[1];
            var relationship = (fixture.relationships || []).filter(function (candidate) {
                return candidate.navigationProperty === nav && (!candidate.entity || candidate.entity === entityType);
            })[0];
            var column = relationship ? relationship.column : nav;
            var valueKey = '_' + column + '_value';

            if (!relationship && !Object.prototype.hasOwnProperty.call(before, valueKey)) {
                failure = undeclaredProperty(nav);

                return;
            }

            carry(oldBag, before, valueKey);
            [valueKey, valueKey + FORMATTED, valueKey + LOOKUP_NAME, valueKey + NAVIGATION].forEach(function (name) {
                delete after[name];
            });

            if (data[key] === null) {
                after[valueKey] = null;
                newBag[valueKey] = null;

                return;
            }

            var reference = String(data[key]).match(/^\/([^(]+)\(([^)]+)\)$/);
            var sets = fixture.entitySets || {};
            var target = reference ? Object.keys(sets).filter(function (table) { return sets[table] === reference[1]; })[0] : undefined;
            var targetRows = target ? tables[target] || [] : [];
            var th = target ? hierarchyOf(fixture, target) : null;
            var related = target
                ? targetRows.filter(function (candidate) { return bareId(candidate[th.id]) === bareId(reference[2]); })[0]
                : undefined;

            if (!related) {
                failure = webApiFault(2147746327, 'Record Is Unavailable', 'The requested record was not found.');

                return;
            }

            after[valueKey] = bareId(reference[2]);
            after[valueKey + FORMATTED] = related[th.name];
            after[valueKey + LOOKUP_NAME] = target;
            after[valueKey + NAVIGATION] = nav;
            carry(newBag, after, valueKey);
        });

        if (failure) {
            return { failure: failure };
        }

        rows[index] = after;

        // Audited, where the fixture audits: a row and its detail, newest.
        if (tables.audit) {
            var n = (writeCount += 1);
            var auditId = 'ffffffff-0000-0000-0000-' + ('000000000000' + n).slice(-12);
            /*
             * The server's clock is after every row it holds; a suite's fake
             * clock need not be, so the row is stamped after the newest one
             * on the record when the clock is behind it.
             */
            var newest = tables.audit
                .filter(function (row) { return bareId(row._objectid_value) === bareId(id); })
                .map(function (row) { return Date.parse(row.createdon) || 0; })
                .reduce(function (a, b) { return a > b ? a : b; }, 0);
            var at = new Date(Math.max(Date.now(), newest + 60000));
            var pad = function (v) { return v < 10 ? '0' + v : String(v); };
            var hour = at.getUTCHours();
            var row = {
                auditid: auditId,
                createdon: at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
                action: 2,
                operation: 2,
                _userid_value: bareId(o.userId),
                _objectid_value: bareId(id),
                objecttypecode: entityType,
                transactionid: auditId,
                attributemask: ',0,',
            };

            row['createdon' + FORMATTED] = (at.getUTCMonth() + 1) + '/' + at.getUTCDate() + '/' + at.getUTCFullYear()
                + ' ' + (hour % 12 || 12) + ':' + pad(at.getUTCMinutes()) + ' ' + (hour < 12 ? 'AM' : 'PM');
            row['action' + FORMATTED] = 'Update';
            row['operation' + FORMATTED] = 'Update';
            row['_userid_value' + FORMATTED] = o.userName;
            row['_userid_value' + LOOKUP_NAME] = 'systemuser';
            row['_objectid_value' + FORMATTED] = after[h.name];
            row['_objectid_value' + LOOKUP_NAME] = entityType;

            tables.audit.unshift(row);
            fixture.audits = fixture.audits || {};
            fixture.audits.details = fixture.audits.details || {};
            fixture.audits.details[auditId] = {
                '@odata.type': '#Microsoft.Dynamics.CRM.AttributeAuditDetail',
                InvalidNewValueAttributes: [],
                LocLabelLanguageCode: 0,
                DeletedAttributes: { Count: 0, Keys: [], Values: [] },
                OldValue: oldBag,
                NewValue: newBag,
            };
        }

        return { failure: null };
    }

    function parentOf(row, h) {
        return h.parent ? bareId(row['_' + h.parent + '_value']) : undefined;
    }

    /**
     * Whether the table's self-referential relationship is hierarchical —
     * from the override, else from `fixture.relationships`, else from whether
     * a `hierarchy` entry exists at all.
     */
    function isHierarchical(fixture, entity, o) {
        if (typeof o.hierarchical === 'boolean') {
            return o.hierarchical;
        }

        var rows = (fixture && fixture.relationships) || [];
        var self = rows.filter(function (row) {
            return row.entity === entity && row.target === entity;
        });

        if (self.length > 0) {
            return self.some(function (row) {
                return row.hierarchical === true;
            });
        }

        return Boolean(fixture && fixture.hierarchy && fixture.hierarchy[entity]);
    }

    /** Every ancestor of `id`, nearest first, stopping at a cycle. */
    function ancestorsOf(rows, h, id) {
        var byId = {};
        rows.forEach(function (row) {
            byId[bareId(row[h.id])] = row;
        });

        var out = [];
        var seen = {};
        var current = byId[bareId(id)];

        while (current && parentOf(current, h) && !seen[parentOf(current, h)]) {
            var parentId = parentOf(current, h);
            seen[parentId] = true;
            current = byId[parentId];

            if (current) {
                out.push(current);
            }
        }

        return out;
    }

    /** Every descendant of `id`, breadth first, stopping at a cycle. */
    function descendantsOf(rows, h, id) {
        var out = [];
        var seen = {};
        var queue = [bareId(id)];

        while (queue.length > 0) {
            var parentId = queue.shift();

            rows.forEach(function (row) {
                var rowId = bareId(row[h.id]);

                if (parentOf(row, h) === parentId && !seen[rowId]) {
                    seen[rowId] = true;
                    out.push(row);
                    queue.push(rowId);
                }
            });
        }

        return out;
    }

    /**
     * The subset of FetchXML this rig reads, by regex: the entity, its
     * attributes (with `alias` and `rowaggregate`), `order`, and the
     * conditions of the first `filter` — combined with `and`. Anything else in
     * the query is ignored rather than refused, so a control sending a
     * `link-entity` gets rows that do not honour it. Say so in the suite.
     */
    function parseFetchXml(xml) {
        var attr = function (tag, name) {
            var m = tag.match(new RegExp('\\b' + name + "=['\"]([^'\"]*)['\"]"));
            return m ? m[1] : undefined;
        };
        var all = function (pattern) {
            var out = [];
            var m;
            while ((m = pattern.exec(xml)) !== null) {
                out.push(m[0]);
            }
            return out;
        };

        var entityTag = xml.match(/<entity\b[^>]*>/);
        var fetchTag = xml.match(/<fetch\b[^>]*>/);

        return {
            entity: entityTag ? attr(entityTag[0], 'name') : undefined,
            top: fetchTag && attr(fetchTag[0], 'top') !== undefined ? Number(attr(fetchTag[0], 'top')) : undefined,
            attributes: all(/<attribute\b[^>]*\/>/g).map(function (tag) {
                return { name: attr(tag, 'name'), alias: attr(tag, 'alias'), rowaggregate: attr(tag, 'rowaggregate') };
            }),
            order: all(/<order\b[^>]*\/>/g).map(function (tag) {
                return { attribute: attr(tag, 'attribute'), descending: attr(tag, 'descending') === 'true' };
            }),
            conditions: all(/<condition\b[^>]*\/>/g).map(function (tag) {
                return { attribute: attr(tag, 'attribute'), operator: attr(tag, 'operator'), value: attr(tag, 'value') };
            }),
        };
    }

    /**
     * Split `text` on a top-level ` and ` or ` or ` — outside parentheses and
     * outside a quoted literal, where `''` is an escaped quote rather than two
     * literals. A type-ahead's `(startswith(a,'x') or startswith(b,'x')) and
     * _p_value eq …` is the shape that needs both halves of that rule.
     */
    function splitTop(text, word) {
        var parts = [];
        var depth = 0;
        var quoted = false;
        var start = 0;
        var pattern = new RegExp('^\\s+' + word + '\\s+', 'i');

        for (var i = 0; i < text.length; i += 1) {
            var ch = text.charAt(i);

            if (ch === "'") {
                quoted = !quoted;
            } else if (!quoted && ch === '(') {
                depth += 1;
            } else if (!quoted && ch === ')') {
                depth -= 1;
            } else if (!quoted && depth === 0 && /\s/.test(ch)) {
                var m = text.slice(i).match(pattern);
                if (m) {
                    parts.push(text.slice(start, i));
                    i += m[0].length - 1;
                    start = i + 1;
                }
            }
        }

        parts.push(text.slice(start));
        return parts;
    }

    /** Whether `text` is one parenthesised group from its first character to its last. */
    function wrapped(text) {
        if (text.charAt(0) !== '(' || text.charAt(text.length - 1) !== ')') {
            return false;
        }
        var depth = 0;
        var quoted = false;
        for (var i = 0; i < text.length; i += 1) {
            var ch = text.charAt(i);
            if (ch === "'") {
                quoted = !quoted;
            } else if (!quoted && ch === '(') {
                depth += 1;
            } else if (!quoted && ch === ')') {
                depth -= 1;
                if (depth === 0 && i < text.length - 1) {
                    return false;
                }
            }
        }
        return depth === 0;
    }

    /** One `$filter` clause as a condition — or an `and`/`or` group of them. */
    function parseClause(clause) {
        var text = clause.trim();

        if (wrapped(text)) {
            return parseClause(text.slice(1, -1));
        }

        var ors = splitTop(text, 'or');
        if (ors.length > 1) {
            return { operator: 'or', clauses: ors.map(parseClause) };
        }

        var ands = splitTop(text, 'and');
        if (ands.length > 1) {
            return { operator: 'and', clauses: ands.map(parseClause) };
        }

        var fn = text.match(/^(contains|startswith)\(\s*_?([a-z0-9_]+?)(?:_value)?\s*,\s*'((?:[^']|'')*)'\s*\)$/i);
        if (fn) {
            return { attribute: fn[2], operator: fn[1].toLowerCase(), value: fn[3].replace(/''/g, "'") };
        }
        var m = text.match(/^_?([a-z0-9_]+?)(?:_value)?\s+(eq|ne|lt|le|gt|ge)\s+(.+)$/i);
        if (!m) {
            return { attribute: text, operator: 'unparsed', value: undefined };
        }
        var raw = m[3].trim();
        var op = m[2].toLowerCase();
        return {
            attribute: m[1],
            operator: raw === 'null' ? (op === 'eq' ? 'null' : 'not-null') : op,
            value: raw.replace(/^'|'$/g, '').replace(/''/g, "'"),
        };
    }

    /** A bound property beyond the first — see `bound` in DEFAULTS. */
    function boundProperty(spec, host, o) {
        if (spec === 'unmapped') {
            return {
                type: null,
                raw: null,
                formatted: undefined,
                attributes: {},
                error: false,
                errorMessage: undefined,
                security: {},
                isPropertyLoading: false,
            };
        }

        var isLookup = spec.type === 'Lookup.Simple';
        var property = {
            type: spec.type,
            raw: spec.raw !== undefined ? spec.raw : isLookup ? [] : null,
            attributes: host.publishesMetadata
                ? { LogicalName: spec.column, DisplayName: spec.label || spec.column }
                : undefined,
            security: spec.security !== undefined ? SECURITY[spec.security] : undefined,
            error: false,
            errorMessage: undefined,
        };

        if (isLookup && o.targetMethod !== 'absent') {
            property.getTargetEntityType = function () {
                if (o.targetMethod === 'throws') {
                    throw new Error('getTargetEntityType is not available on this host.');
                }
                return spec.target;
            };
            property.getViewId = function () {
                if (o.targetMethod === 'throws') {
                    throw new Error('getViewId is not available on this host.');
                }
                return '00000000-0000-0000-00aa-000010001003';
            };
        }

        return property;
    }

    /** The first clause, at any depth, the subset could not read. */
    function unparsedIn(conditions) {
        for (var i = 0; i < conditions.length; i += 1) {
            var c = conditions[i];
            if (c.operator === 'unparsed') {
                return c;
            }
            var inner = c.clauses ? unparsedIn(c.clauses) : null;
            if (inner) {
                return inner;
            }
        }
        return null;
    }

    /**
     * The OData subset: `$select`, `$filter` (`x eq v`, `x ne v`,
     * `x lt|le|gt|ge v`, `contains(x,'v')` and `startswith(x,'v')`, joined by
     * `and` and `or` and grouped by parentheses), `$orderby`, `$top`, and
     * `$skiptoken` — the offset a `nextLink` from this rig carries, applied
     * after ordering. `options` may be a full URL on the host's origin: a
     * control that hands a `nextLink` back as `options` is asking for the
     * next page, and the rig reads the query off it.
     *
     * A clause the subset cannot read is **refused**, the way the server
     * refuses a malformed filter. It used to pass every row, which meant a
     * suite asserting a filtered count against an operator nobody added here
     * asserted nothing — the dataset rig had already stopped doing that. If a
     * control's real query is refused here, add the operator.
     */
    function parseOData(query) {
        var part = function (name) {
            var m = query.match(new RegExp('[?&]\\' + name + '=([^&]*)'));
            return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : undefined;
        };
        var select = part('$select');
        var filter = part('$filter');
        var orderby = part('$orderby');
        var top = part('$top');
        var skip = part('$skiptoken');

        return {
            attributes: select ? select.split(',').map(function (name) { return { name: name.trim() }; }) : [],
            top: top !== undefined ? Number(top) : undefined,
            skip: skip !== undefined ? Number(skip) : 0,
            order: orderby
                ? orderby.split(',').map(function (clause) {
                    var bits = clause.trim().split(/\s+/);
                    return { attribute: bits[0], descending: bits[1] === 'desc' };
                })
                : [],
            conditions: filter ? [parseClause(filter)] : [],
        };
    }

    /** One row's value for a condition attribute — a lookup by its `_x_value`. */
    function valueOf(row, attribute) {
        if (Object.prototype.hasOwnProperty.call(row, attribute)) {
            return row[attribute];
        }
        return row['_' + attribute + '_value'];
    }

    /**
     * Answer a `retrieveMultipleRecords` from the fixture: an OData query or a
     * `?fetchXml=` one, encoded or not. Rejects, in the fault shape, a
     * hierarchical operator on a table whose relationship is not hierarchical.
     *
     * Two things reproduced on purpose because a control that does not expect
     * them is wrong on a form: **a FetchXML result omits null-valued
     * properties** (the Web API documents this; an OData result carries them),
     * and a `rowaggregate='CountChildren'` attribute arrives under its alias.
     * `maxPageSize` truncates and sets `nextLink`; `top` truncates and does not.
     */
    function answerQuery(fixture, entity, options, maxPageSize, o) {
        var query = String(options || '');
        if (/^https?:\/\//i.test(query)) {
            // A `nextLink` handed back as `options`: the query is what matters.
            query = query.indexOf('?') === -1 ? '' : query.slice(query.indexOf('?'));
        }
        var isFetch = /^\?fetchXml=/i.test(query);
        var rows = ((fixture && fixture.tables) || {})[entity] || [];

        if (entity === 'organization' && rows.length === 0 && o.auditEnabled) {
            // One row, and only the columns a control has been seen to ask
            // for. A fixture that ships an `organization` table wins.
            rows = [{ organizationid: '00000000-0000-0000-0000-00000000000f', isauditenabled: Boolean(o.auditEnabled.org) }];
        }
        var h = hierarchyOf(fixture, entity);
        var q;

        if (isFetch) {
            var xml = query.slice(query.indexOf('=') + 1);
            if (xml.charAt(0) !== '<') {
                xml = decodeURIComponent(xml);
            }
            q = parseFetchXml(xml);
        } else {
            q = parseOData(query);
        }

        var HIERARCHICAL = ['above', 'eq-or-above', 'under', 'eq-or-under', 'not-under'];
        var needsHierarchy = q.conditions.some(function (c) {
            return HIERARCHICAL.indexOf(c.operator) !== -1;
        });

        if (needsHierarchy && !isHierarchical(fixture, entity, o)) {
            /*
             * The measured shape (pcf-hierarchy-view 0.0.1 probe, Accounts
             * form, 2026-09-17): a plain object, `errorCode` and `code` both
             * 2147746307, `title` "Invalid Argument", `message` "Invalid
             * Argument." — the server says nothing about hierarchy, which is
             * why a control asks the metadata first rather than the query.
             */
            return Promise.reject(webApiFault(2147746307, 'Invalid Argument', 'Invalid Argument.'));
        }

        var refused = isFetch ? null : unparsedIn(q.conditions);
        if (refused) {
            // The rig's own wording; the code is the server's for a query it
            // cannot read (0x80060888).
            return Promise.reject(webApiFault(2147879048, '', 'The rig cannot read this $filter clause: ' + refused.attribute));
        }

        var matched = rows.filter(function (row) {
            return q.conditions.every(function test(c) {
                if (c.operator === 'or') {
                    return c.clauses.some(test);
                }
                if (c.operator === 'and') {
                    return c.clauses.every(test);
                }
                var actual = valueOf(row, c.attribute);
                var wanted = c.value;
                var same = function () {
                    return bareId(actual) === bareId(wanted) || String(actual) === String(wanted);
                };

                var present = actual !== null && actual !== undefined;
                var compare = function () {
                    // Numbers as numbers, everything else as strings — an ISO
                    // instant sorts as text, which is why the shape is chosen.
                    var x = typeof actual === 'number' ? actual : String(actual);
                    var y = typeof actual === 'number' ? Number(wanted) : String(wanted);
                    return x < y ? -1 : x > y ? 1 : 0;
                };

                switch (c.operator) {
                    case 'eq': return present && same();
                    case 'ne': case 'neq': return !present || !same();
                    case 'null': return !present;
                    case 'not-null': return present;
                    case 'lt': return present && compare() < 0;
                    case 'le': return present && compare() <= 0;
                    case 'gt': return present && compare() > 0;
                    case 'ge': return present && compare() >= 0;
                    case 'contains': return present && String(actual).toLowerCase().indexOf(String(wanted).toLowerCase()) !== -1;
                    case 'startswith': return present && String(actual).toLowerCase().indexOf(String(wanted).toLowerCase()) === 0;
                    case 'above': return ancestorsOf(rows, h, wanted).indexOf(row) !== -1;
                    case 'eq-or-above': return bareId(row[h.id]) === bareId(wanted) || ancestorsOf(rows, h, wanted).indexOf(row) !== -1;
                    case 'under': return descendantsOf(rows, h, wanted).indexOf(row) !== -1;
                    case 'eq-or-under': return bareId(row[h.id]) === bareId(wanted) || descendantsOf(rows, h, wanted).indexOf(row) !== -1;
                    case 'not-under': return bareId(row[h.id]) !== bareId(wanted) && descendantsOf(rows, h, wanted).indexOf(row) === -1;
                    default: return true;
                }
            });
        });

        q.order.slice().reverse().forEach(function (clause) {
            matched = matched.slice().sort(function (a, b) {
                var x = valueOf(a, clause.attribute);
                var y = valueOf(b, clause.attribute);
                var r = x === y ? 0 : x === null || x === undefined ? -1 : y === null || y === undefined ? 1 : x < y ? -1 : 1;
                return clause.descending ? -r : r;
            });
        });

        if (q.top !== undefined) {
            matched = matched.slice(0, q.top);
        }

        var offset = q.skip || 0;
        var remaining = offset > 0 ? matched.slice(offset) : matched;
        /*
         * **The audit table ignores `maxPageSize`.** Measured on the Accounts
         * form 2026-09-18 (pcf-audit-history P2/P3): fifteen rows came back
         * for a page size of five, with an empty `nextLink`. Cosmos-backed,
         * and paged only through the audit functions' PagingInfo. A control
         * that pages the audit table by `maxPageSize` passes on a fixture and
         * loads everything on a form.
         */
        var pageSize = entity === 'audit' ? 0 : maxPageSize;
        var page = pageSize > 0 && remaining.length > pageSize ? remaining.slice(0, pageSize) : remaining;
        var wanted = q.attributes.filter(function (a) { return !a.rowaggregate; }).map(function (a) { return a.name; });
        var counts = q.attributes.filter(function (a) { return a.rowaggregate === 'CountChildren'; });

        var entities = page.map(function (source) {
            var entity = {};

            Object.keys(source).forEach(function (key) {
                var column = key.split('@')[0];
                var keep = wanted.length === 0
                    || wanted.indexOf(column) !== -1
                    || (column.charAt(0) === '_' && wanted.indexOf(column.replace(/^_|_value$/g, '')) !== -1)
                    || column === h.id;

                if (keep && !(isFetch && (source[key] === null || source[key] === undefined))) {
                    entity[key] = source[key];
                }
            });

            counts.forEach(function (a) {
                var id = bareId(source[h.id]);
                entity[a.alias || 'children'] = rows.filter(function (row) {
                    return parentOf(row, h) === id;
                }).length;
            });

            return entity;
        });

        var result = { entities: entities };

        if (entity === 'audit') {
            result.nextLink = '';
        }

        if (offset + page.length < matched.length) {
            /*
             * The server's `nextLink` is the original query plus a
             * continuation, and a control may hand it straight back as
             * `options` — so it has to carry the filter and the order, or
             * page two answers a different question. The rig's continuation
             * is an offset; the server's is opaque, and a control must never
             * read it.
             */
            var base = isFetch ? '' : query.replace(/[?&]\$skiptoken=\d+/, '');
            result.nextLink = (o.clientUrl || clientUrlFor(1)) + '/api/data/v9.2/' + entity + 's'
                + (base || '?') + (base ? '&' : '') + '$skiptoken=' + (offset + page.length);
            if (isFetch) {
                result.fetchXmlPagingCookie = '<cookie page="1"><' + h.id + ' last="' + bareId(page[page.length - 1][h.id]) + '" /></cookie>';
            }
        }

        return Promise.resolve(result);
    }

    /**
     * A `RetrieveAuditDetails` / `RetrieveRecordChangeHistory` refusal, by the
     * `auditStatus` switch. `null` means "answer".
     */
    function auditRefusal(o) {
        var status = o.auditStatus;

        if (status === 200 || status === undefined) {
            return null;
        }
        if (status === 0) {
            return Promise.reject(new TypeError('Failed to fetch'));
        }

        return reply(status, {
            error: {
                code: '0x80040220',
                message: 'Principal user is missing prvReadRecordAuditHistory privilege.',
            },
        });
    }

    /**
     * `fixture.audits.details[id]` with the audit row attached as
     * `AuditRecord` — **the platform sends it on every AuditDetail**, with
     * the row's formatted values under Prefer (measured on the Accounts
     * form 2026-09-18, pcf-audit-history P13/P14), whatever Learn says about
     * the Web API omitting it. `undefined` for an id the fixture does not
     * hold. `transactionid` and `versionnumber` arrive zeroed from the
     * record-history function and real from the bound one; neither is read.
     */
    function auditDetailOf(fixture, id, annotated) {
        var details = (fixture.audits && fixture.audits.details) || {};
        var key = Object.keys(details).filter(function (candidate) { return bareId(candidate) === bareId(id); })[0];
        var row = ((fixture.tables || {}).audit || []).filter(function (candidate) { return bareId(candidate.auditid) === bareId(id); })[0];

        if (!key) {
            return undefined;
        }

        var record = { '@odata.type': '#Microsoft.Dynamics.CRM.audit' };

        Object.keys(row || {}).forEach(function (name) {
            if (annotated || name.indexOf('@') === -1) {
                record[name] = row[name];
            }
        });

        var out = {};
        Object.keys(details[key]).forEach(function (name) {
            out[name] = details[key][name];
            if (name === 'DeletedAttributes') {
                out.AuditRecord = record;
            }
        });
        if (!out.AuditRecord) {
            out.AuditRecord = record;
        }

        return out;
    }

    /** Whether the request carried `Prefer: odata.include-annotations`. */
    function wantsAnnotations(init) {
        var headers = (init && init.headers) || {};
        var prefer = headers.Prefer || headers.prefer || '';

        return /include-annotations/.test(String(prefer));
    }

    /**
     * Register this host's origin with the shared `fetch` stub. Answers what a
     * field control has been seen to read off the organisation URL — the
     * metadata `context.webAPI` cannot address (`EntityDefinitions(
     * LogicalName='x')` for `EntitySetName` or `IsAuditEnabled`, and its
     * `ManyToOneRelationships` or `OneToManyRelationships`) and the two audit
     * **functions** it cannot call (`audits(<id>)/Microsoft.Dynamics.CRM.
     * RetrieveAuditDetails`, bound to the row; `RetrieveRecordChangeHistory(
     * Target=@t,PagingInfo=@p)` and `RetrieveAttributeChangeHistory(…)`,
     * unbound, their arguments as `@`-aliases in the query string) — and
     * refuses everything else on its origin by rejecting, the way an unknown
     * path would 404 into a `.json()` that throws.
     *
     * The function answers carry an `AuditRecord` on every `AuditDetail`,
     * as the form does (SPEC.md P13/P14) and Learn says it does not; see
     * `auditDetailOf`.
     */
    function installFetch(clientUrl, o, log, hostFixture) {
        var scope = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null);
        var fixture = hostFixture || o.fixture || {};
        var prefix = clientUrl + '/api/data/v9.2/';

        if (!scope) {
            return;
        }

        hostsByUrl[clientUrl] = function (url, init) {
            var address = String(url);
            var annotated = wantsAnnotations(init);

            // ---- WebResources/<name> — configuration, same-origin ----------
            if (address.indexOf(clientUrl + '/WebResources/') === 0) {
                log('fetch', address.slice(clientUrl.length));

                return webResourceReply(o, fixture, address.slice((clientUrl + '/WebResources/').length));
            }

            if (address.indexOf(prefix) !== 0) {
                return Promise.reject(new Error('No fetch for ' + address));
            }

            log('fetch', address.slice(clientUrl.length));

            var path = address.slice(prefix.length);
            var refusal;

            // ---- audits(<id>)/Microsoft.Dynamics.CRM.RetrieveAuditDetails ----
            var bound = path.match(/^audits\(([0-9a-z{}-]+)\)\/Microsoft\.Dynamics\.CRM\.RetrieveAuditDetails$/i);

            if (bound) {
                refusal = auditRefusal(o);
                if (refusal) {
                    return refusal;
                }
                var detail = auditDetailOf(fixture, bound[1], annotated);

                return detail
                    ? reply(200, { AuditDetail: detail })
                    : reply(404, { error: { code: '0x80040217', message: 'audit With Id = ' + bound[1] + ' Does Not Exist' } });
            }

            // ---- RetrieveRecordChangeHistory / RetrieveAttributeChangeHistory ----
            var unbound = path.match(/^(RetrieveRecordChangeHistory|RetrieveAttributeChangeHistory)\(([^)]*)\)\?(.*)$/);

            if (unbound) {
                refusal = auditRefusal(o);
                if (refusal) {
                    return refusal;
                }
                var aliases = {};
                unbound[3].split('&').forEach(function (pair) {
                    var at = pair.indexOf('=');
                    if (pair.charAt(0) === '@' && at !== -1) {
                        aliases[pair.slice(1, at)] = decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' '));
                    }
                });
                var named = {};
                unbound[2].split(',').forEach(function (pair) {
                    var m = pair.match(/^(\w+)=@(\w+)$/);
                    if (m) {
                        named[m[1]] = aliases[m[2]];
                    }
                });
                var ref = (named.Target || '').match(/'@odata\.id'\s*:\s*'([a-z0-9_]+)\(([0-9a-z{}-]+)\)'/i);
                var paging = {};
                try {
                    paging = named.PagingInfo ? JSON.parse(named.PagingInfo) : {};
                } catch (e) {
                    paging = {};
                }
                if (!ref) {
                    return reply(400, { error: { code: '0x80060888', message: 'Target is not an entity reference.' } });
                }
                var column = unbound[1] === 'RetrieveAttributeChangeHistory'
                    ? String(named.AttributeLogicalName || '').replace(/^'|'$/g, '').toLowerCase()
                    : null;
                var all = ((fixture.tables || {}).audit || [])
                    .filter(function (row) { return bareId(row._objectid_value) === bareId(ref[2]); })
                    .sort(function (a, b) { return a.createdon < b.createdon ? 1 : a.createdon > b.createdon ? -1 : 0; })
                    .map(function (row) { return auditDetailOf(fixture, row.auditid, annotated); })
                    .filter(function (d) {
                        if (!d) {
                            return false;
                        }
                        if (column === null) {
                            return true;
                        }
                        return [d.OldValue, d.NewValue].some(function (bag) {
                            return bag && Object.keys(bag).some(function (key) {
                                return key.split('@')[0].replace(/^_|_value$/g, '').toLowerCase() === column;
                            });
                        });
                    });
                var count = paging.Count > 0 ? paging.Count : all.length;
                var pageNumber = paging.PageNumber > 0 ? paging.PageNumber : 1;
                var slice = all.slice((pageNumber - 1) * count, pageNumber * count);

                return reply(200, {
                    '@odata.context': clientUrl + '/api/data/v9.2/$metadata#Microsoft.Dynamics.CRM.' + unbound[1] + 'Response',
                    AuditDetailCollection: {
                        MoreRecords: pageNumber * count < all.length,
                        PagingCookie: pageNumber * count < all.length ? '<cookie page="' + pageNumber + '"><cookieExtensions ContinuationToken="rig" /></cookie>' : '',
                        TotalRecordCount: paging.ReturnTotalRecordCount ? all.length : -1,
                        AuditDetails: slice,
                    },
                });
            }

            // ---- EntityDefinitions?… — the table list ---------------------------
            // The whole list in one answer, as a form gave it (pcf-code-editor
            // 1.4.9 P1: 860 tables, no paging, `no-cache`), sorted by logical
            // name, with only what `$select` names. See `tableListAnswer`.
            if (path.indexOf('EntityDefinitions?') === 0) {
                return metadataReply(o, function () {
                    return tableListAnswer(fixture, o, queryOf(path.slice('EntityDefinitions?'.length)));
                });
            }

            // ---- EntityDefinitions(LogicalName='x') … --------------------------
            var definitionPrefix = "EntityDefinitions(LogicalName='";

            if (path.indexOf(definitionPrefix) !== 0) {
                return Promise.reject(new Error('No fetch for ' + address));
            }

            var rest = path.slice(definitionPrefix.length);
            var entity = (rest.match(/^([a-z0-9_]+)'\)/i) || [])[1];

            if (!entity) {
                return Promise.reject(new Error('No fetch for ' + address));
            }

            var afterName = rest.slice(entity.length + 2);
            var at = afterName.indexOf('?');
            var tail = at === -1 ? afterName : afterName.slice(0, at);
            var query = queryOf(at === -1 ? '' : afterName.slice(at + 1));

            // ---- …?$expand=…Relationships(…) — all three kinds in one call -----
            // Measured accepted in one request (1.4.9 P3: 22 + 60 + 5 on
            // account, 22 KB, 102 ms), each kind with its own `$select`.
            if (tail === '' && query.$expand !== undefined) {
                return metadataReply(o, function () {
                    return expandAnswer(fixture, o, entity, query);
                });
            }

            if (tail === '') {
                var set = (fixture.entitySets || {})[entity] || (metadataTable(fixture, entity) || {}).entitySet;
                var table = metadataTable(fixture, entity) || {};
                var selected = (query.$select || 'EntitySetName').split(',');

                if (set === undefined) {
                    return reply(404, {
                        error: { code: '0x80060888', message: "Could not find a property named '" + entity + "'." },
                    });
                }

                var body = { LogicalName: entity };
                if (selected.indexOf('EntitySetName') !== -1) {
                    body.EntitySetName = set;
                }
                if (selected.indexOf('PrimaryIdAttribute') !== -1) {
                    body.PrimaryIdAttribute = primaryIdOf(fixture, entity);
                }
                if (selected.indexOf('PrimaryNameAttribute') !== -1) {
                    body.PrimaryNameAttribute = table.primaryName === undefined ? null : table.primaryName;
                }
                if (selected.indexOf('DisplayName') !== -1) {
                    body.DisplayName = labelOf(table.label, o, query);
                }
                if (selected.indexOf('IsIntersect') !== -1) {
                    body.IsIntersect = Boolean(table.intersect);
                }
                if (selected.indexOf('IsAuditEnabled') !== -1) {
                    body.IsAuditEnabled = {
                        Value: Boolean(o.auditEnabled && o.auditEnabled.table),
                        CanBeChanged: true,
                        ManagedPropertyLogicalName: 'canmodifyauditsettings',
                    };
                }
                return reply(200, body);
            }

            // ---- EntityDefinitions(LogicalName='x')/Attributes?$select=… ------
            // Every column's IsValidForUpdate — measured (pcf-audit-history
            // R6) as the only place it lives: getEntityMetadata's items do
            // not carry it — and, for a table in `fixture.metadata`, its
            // type, labels, readability and shadow (1.4.9 P2). See
            // `attributesAnswer`; a table the fixture does not name is a 404,
            // as the server answers.
            if (tail === '/Attributes') {
                return metadataReply(o, function () {
                    return attributesAnswer(fixture, o, entity, query);
                });
            }

            // ---- …/Attributes(LogicalName='y')/Microsoft.Dynamics.CRM.<T>AttributeMetadata
            // A choice's options, one cast per type (1.4.9 P4: every cast took
            // the nested `$select`). See `optionsAnswer`.
            var cast = tail.match(/^\/Attributes\(LogicalName='([a-z0-9_]+)'\)\/Microsoft\.Dynamics\.CRM\.(\w+)AttributeMetadata$/i);

            if (cast) {
                return metadataReply(o, function () {
                    return optionsAnswer(fixture, o, entity, cast[1], cast[2], query);
                });
            }

            var direction = { '/OneToManyRelationships': 'one', '/ManyToOneRelationships': 'many', '/ManyToManyRelationships': 'both' }[tail];

            if (!direction) {
                return Promise.reject(new Error('No fetch for ' + address));
            }

            var status = o.relationshipsStatus;

            if (status === 0) {
                return Promise.reject(new TypeError('Failed to fetch'));
            }

            return reply(status, status === 200
                ? { value: relationshipRows(fixture, o, entity, direction) }
                : { error: { code: '0x80040220', message: 'Refused by the rig.' } });
        };

        if (!scope.__pcfHostFetch) {
            var previous = scope.fetch;

            scope.__pcfHostFetch = function (url, init) {
                var address = String(url);
                var origin = Object.keys(hostsByUrl).filter(function (candidate) {
                    return address.indexOf(candidate + '/') === 0;
                })[0];

                if (origin) {
                    return hostsByUrl[origin](url, init);
                }

                return previous
                    ? previous.call(scope, url, init)
                    : Promise.reject(new Error('No fetch for ' + address));
            };
            scope.fetch = scope.__pcfHostFetch;
        }
    }

    /**
     * `context.navigation`, assembled method by method.
     *
     * **Presence is per method, not per bag**, and that is the whole reason
     * this is a function rather than an object literal. `openUrl` is there on
     * every host; `openForm`, `openWebResource` and `openFile` are documented
     * model-driven only; the three dialogs are a model-driven affordance that
     * canvas does not have. A control that checks `context.navigation` once and
     * then calls a method through it passes on the host it was written on and
     * throws a TypeError on the next one — so each of these is removed
     * independently here, because each is removed independently in the world.
     *
     * The same shape as the dataset rig's, so an assertion reads the same in
     * both.
     */
    function buildNavigation(o, log) {
        if (!o.hasNavigation) {
            return undefined;
        }

        var navigation = {
            /**
             * **Returns `void`, not a promise.** The odd one out in this bag,
             * and `void openUrl(...)` in the type definitions — so `await`ing
             * it is harmless and `.catch()` on it is a TypeError. There is also
             * no failure channel: a URL the host refuses to open reports
             * nothing back, which is why a control has to decide the URL is
             * acceptable *before* it calls.
             */
            openUrl: function (url) {
                log('navigation.openUrl', url);
            },
        };

        /*
         * `openForm` — model-driven only, so canvas never has it whatever the
         * switch says. It arrived with the first field control that opens a
         * record (`pcf-hierarchy-view`, a card click); before that its absence
         * was the rule, on the grounds that a stub nothing calls is a stub
         * nobody maintains.
         *
         * Resolves `{ savedEntityReference: null }` — what a form the user
         * navigated to and away from reports — so a control that reads the
         * reference without checking it has that branch under test.
         */
        if (o.host !== 'canvas' && o.openForm !== 'absent') {
            navigation.openForm = function (options, parameters) {
                log('navigation.openForm', parameters === undefined ? options : { options: options, parameters: parameters });

                return o.openForm === 'rejects'
                    ? Promise.reject(webApiFault(2147746581, '', 'The form could not be opened.'))
                    : Promise.resolve({ savedEntityReference: null });
            };
        }

        /*
         * 'absent' removes the three rather than making them fail, because
         * those are different states and only one of them is a bug in the
         * control. This is the state canvas is in.
         */
        if (o.dialogs === 'absent') {
            return navigation;
        }

        var refused = function () {
            return Promise.reject({
                errorCode: 2147746581,
                message: 'The dialog could not be opened.',
            });
        };

        navigation.openAlertDialog = function (alertStrings) {
            log('navigation.openAlertDialog', (alertStrings || {}).text);
            return o.dialogs === 'rejected' ? refused() : Promise.resolve();
        };

        /**
         * The one that matters, and the one everybody gets wrong.
         *
         * **Cancel is a resolve.** `{ confirmed: false }` comes back through the
         * success path, not through `catch` — so a control that puts its action
         * inside `.then()` without reading `confirmed` does the thing the user
         * just declined, and a control that treats the cancel as a failure
         * shows an error for something the user did on purpose. Both are one
         * line away from correct and neither shows up without this switch.
         */
        navigation.openConfirmDialog = function (confirmStrings) {
            log('navigation.openConfirmDialog', (confirmStrings || {}).text);

            return o.dialogs === 'rejected'
                ? refused()
                : Promise.resolve({ confirmed: o.dialogs === 'confirmed' });
        };

        navigation.openErrorDialog = function (errorOptions) {
            /*
             * `details` is logged, and that is not tidiness.
             *
             * The control writes its own sentence into `message` and the
             * *platform's* explanation into `details`, so an assertion that
             * reads only `message` is reading a slot the platform never filled
             * — it passes whether or not the rejection was ever decoded, which
             * makes "and NOT [object Object]" a claim about nothing. Both
             * halves are recorded so both can be asserted.
             */
            log('navigation.openErrorDialog', {
                message: (errorOptions || {}).message,
                details: (errorOptions || {}).details,
                errorCode: (errorOptions || {}).errorCode,
            });

            return o.dialogs === 'rejected' ? refused() : Promise.resolve();
        };

        return navigation;
    }

    /**
     * `context.events`, from either an array of names or an object of handlers.
     *
     * See the comment at the `events:` member for why both shapes exist. A
     * handler that throws is **not** caught here: the platform does not promise
     * to catch a maker's handler either, and a control that raises an event
     * without a `try` around it should fail this rig rather than production.
     */
    function buildEvents(events, log) {
        if (events === null || events === undefined) {
            return undefined;
        }

        var names = Array.isArray(events) ? events : Object.keys(events);

        return names.reduce(function (bag, name) {
            var handler = Array.isArray(events) ? undefined : events[name];

            bag[name] = function (payload) {
                log('events.' + name, payload);

                if (typeof handler === 'function') {
                    handler(payload);
                }
            };

            return bag;
        }, {});
    }

    /**
     * Build a `context` for a field control.
     *
     * Anything not named in `options` comes from DEFAULTS, so a caller states
     * only the state it is interested in — which is what lets an assertion in
     * `smoke.js` read as a sentence about one branch.
     */
    function createContext(options) {
        var o = Object.assign({}, DEFAULTS, options || {});

        /*
         * Every platform call the control made, in order, with its argument.
         *
         * The same shape and the same formatting as the dataset rig's, so an
         * assertion reads the same in both: `trackContainerResize(true)`,
         * `events.OnSelect()`. The array is supplied by the caller rather than
         * held here, because `createContext` is called afresh for every render
         * and a log that reset with it could not span one.
         */
        function log(name, argument) {
            if (o.calls) {
                o.calls.push(argument === undefined ? name : name + '(' + JSON.stringify(argument) + ')');
            }
        }

        var host = HOSTS[o.host] || HOSTS['model-driven'];
        var security = SECURITY[o.security];
        var clientUrl = o.clientUrl || nextClientUrl();
        var isLookup = o.valueType === 'Lookup.Simple';
        // This host's own rows — see `fixtureFor`.
        var fixture = fixtureFor(clientUrl, o.fixture);

        installFetch(clientUrl, o, log, fixture);

        function fails() {
            return o.webApiFails
                ? Promise.reject(webApiFault(2147746581, '', 'The request could not be completed.'))
                : null;
        }

        var getString =
            o.getString
            || function (key) {
                return STRINGS[key] !== undefined ? STRINGS[key] : key;
            };

        // The control's own inputs, wrapped the way the platform hands them
        // over. A raw `null` is a real value here — a property the maker left
        // unset — so it is passed through rather than defaulted.
        var parameters = {};

        Object.keys(o.inputs).forEach(function (name) {
            parameters[name] = { raw: o.inputs[name] };
        });

        Object.keys(o.bound || {}).forEach(function (name) {
            parameters[name] = boundProperty(o.bound[name], host, o);
        });

        return {
            /*
             * The literals FIRST and `parameters` second, so `options.inputs`
             * wins — which is what the `inputs` comment in DEFAULTS already
             * claims. The other order shipped, and it meant a control with its
             * own `placeholder` input could not be tested with a different
             * placeholder: the literal below silently overwrote it.
             */
            parameters: Object.assign({
                value: {
                    raw: o.value,
                    /*
                     * Present only where the host has column metadata.
                     *
                     * The control reads `parameter.attributes?.MaxLength`, and
                     * that single `?` is the whole canvas/model-driven
                     * difference. Supplying it on canvas would hide the one bug
                     * this switch exists to find.
                     */
                    attributes: host.publishesMetadata
                        ? { MaxLength: o.maxLength, LogicalName: o.column, DisplayName: o.label }
                        : undefined,
                    /*
                     * `undefined` unless the column carries a field-level
                     * security profile — see SECURITY above. The common case is
                     * absence, and absence is what unguarded code breaks on.
                     */
                    security: security,
                    error: o.error,
                    // The platform sets no message when there is no error.
                    errorMessage: o.error ? o.errorMessage : undefined,
                    type: o.valueType,
                },
                placeholder: { raw: o.placeholder, type: 'SingleLine.Text' },
            }, parameters, isLookup && o.targetMethod !== 'absent'
                ? {
                    value: Object.assign({}, {
                        raw: o.value,
                        attributes: host.publishesMetadata
                            ? { LogicalName: o.column, DisplayName: o.label }
                            : undefined,
                        security: security,
                        error: o.error,
                        errorMessage: o.error ? o.errorMessage : undefined,
                        type: o.valueType,
                        /*
                         * The two methods only a lookup binding has. 'throws'
                         * is a host that has the method and cannot answer it —
                         * the hub's harness, before it had none.
                         */
                        getTargetEntityType: function () {
                            if (o.targetMethod === 'throws') {
                                throw new Error('getTargetEntityType is not available on this host.');
                            }
                            return o.target;
                        },
                        getViewId: function () {
                            if (o.targetMethod === 'throws') {
                                throw new Error('getViewId is not available on this host.');
                            }
                            return '00000000-0000-0000-00aa-000010001002';
                        },
                    }, parameters.value || {}),
                }
                : {}),

            mode: {
                isVisible: o.visible,
                isControlDisabled: o.disabled,
                label: o.label,
                /*
                 * Recorded, not delivered.
                 *
                 * The platform sends `allocatedWidth` only to a control that
                 * asked, and asking is this call — so "did it ask" is a
                 * decision worth asserting, while "did the width then change"
                 * is a platform behaviour this file cannot honestly reproduce.
                 * Set `width` to drive the second.
                 */
                trackContainerResize: function (value) {
                    log('trackContainerResize', value);
                },
                setFullScreen: function (value) {
                    log('setFullScreen', value);
                },

                /*
                 * `mode.setControlState` — the only way a control keeps anything
                 * of its own across a remount.
                 *
                 * The remount people forget is a **form tab switch**: moving to
                 * another tab and back destroys the control and inits a new one,
                 * so an unsaved edit, a scroll position or an expanded section
                 * is gone unless it was handed to the platform here. It comes
                 * back as `init`'s third argument, which is the parameter almost
                 * every control names `_state` and ignores.
                 *
                 * **It returns a boolean and the boolean is not decoration.**
                 * The platform refuses when it has nowhere to put the state, and
                 * a control that assumes success renders a restored view that
                 * was never saved. `stateWritable: false` reproduces the refusal.
                 *
                 * Recorded rather than stored: what regresses is *what the
                 * control chose to persist*, and the round trip is the suite's
                 * to make — mount, read the call, mount again with `state` set
                 * to what it saved. Keeping a bag here would hide the half of
                 * that contract the control is actually responsible for.
                 */
                setControlState: function (state) {
                    log('setControlState', state);

                    return o.stateWritable !== false;
                },

                allocatedWidth: o.width,
                allocatedHeight: o.height,

                /*
                 * The record this control is sitting on — undocumented, untyped,
                 * and absent by default.
                 *
                 * `ComponentFramework.Mode` does not declare this member, so
                 * reading it costs a cast; and the platform's own FAQ says code
                 * components are not given the record's identity "because they
                 * need to be supported on multiple surfaces where this
                 * information may not be available", naming bound input
                 * properties as the supported route instead. Both are real, the
                 * cast is what everybody actually writes, and only one of them
                 * survives canvas — so a control that needs identity should try
                 * this and fall back, and the default here is what makes it
                 * write the fallback.
                 */
                contextInfo: o.contextInfo || undefined,
            },

            resources: {
                getString: getString,

                /*
                 * Callback-style, not a promise — the one API on `context` that
                 * is, which is why code around it tends to be written as though
                 * it returned something and silently gets `undefined`.
                 *
                 * The failure path is the default. See `resource` in DEFAULTS.
                 */
                getResource: function (name, success, failure) {
                    log('getResource', name);

                    if (o.resource === null || o.resource === undefined) {
                        if (failure) {
                            failure();
                        }

                        return;
                    }

                    if (success) {
                        success(o.resource);
                    }
                },
            },

            /*
             * Every method rejects unless the caller supplied something for it
             * to resolve with, which is what a browser without the host's
             * native bridge does. A control that declares
             * `<uses-feature required="false">` and degrades is testable here;
             * one that assumes the call succeeds hangs on its own promise.
             *
             * **The refusals are not one refusal.** A device API can fail three
             * distinguishable ways and only one of them is an `Error`, so a
             * stub that rejected uniformly would let a control pass here with a
             * handler that throws in two of the three states a real device puts
             * it in. See `position` in DEFAULTS for what each one means.
             */
            device: !o.device ? undefined : {
                pickFile: function (pickOptions) {
                    log('pickFile', pickOptions || {});

                    return o.pickFile
                        ? Promise.resolve(o.pickFile)
                        : Promise.reject(new Error('No file picker on this host.'));
                },

                /*
                 * Resolves with **one** `FileObject`, where `pickFile` resolves
                 * with an array of them. That asymmetry is the platform's, not
                 * this file's, and it is why both are stubbed rather than one.
                 */
                captureImage: function (imageOptions) {
                    log('captureImage', imageOptions || {});

                    return o.captureImage
                        ? Promise.resolve(o.captureImage)
                        : Promise.reject(new Error('No camera on this host.'));
                },

                getBarcodeValue: function () {
                    log('getBarcodeValue');

                    return Promise.reject(new Error('No scanner on this host.'));
                },

                /*
                 * Geolocation, and its three separate refusals.
                 *
                 * The resolved shape is the one worth reading twice.
                 * `Position.timestamp` is typed `Date` by
                 * `@types/powerapps-component-framework` and documented, on the
                 * very same page, as a DOMTimeStamp — which is a **number**. The
                 * platform sends the number, so that is what this sends, and
                 * `position.timestamp.toISOString()` therefore compiles against
                 * the types and throws against the host. Handing back a real
                 * `Date` here to match the type would make this rig the only
                 * place that bug cannot be found.
                 *
                 * `coords` carries every member the interface declares, because
                 * they are all non-optional there while `altitude`, `heading`
                 * and `speed` are routinely null on a device standing still —
                 * another lie in the types, and one a control that formats them
                 * has to survive.
                 */
                getCurrentPosition: o.position === 'absent' ? undefined : function () {
                    log('getCurrentPosition');

                    if (o.position === 'denied') {
                        /*
                         * A plain object, not an `Error` — the Client API's
                         * `errorCallback` documents `code` and `message`. Note
                         * `code`, where a webAPI rejection says `errorCode`:
                         * two platform APIs, two names, and one error reader
                         * that has to know both.
                         */
                        return Promise.reject({
                            code: 1,
                            message: 'The user denied access to their location.',
                        });
                    }

                    if (o.position === 'unavailable') {
                        // Documented, and the shape nothing survives by accident.
                        return Promise.reject(null);
                    }

                    if (o.position === 'no-bridge' || !o.position) {
                        return Promise.reject(new Error('No geolocation on this host.'));
                    }

                    return Promise.resolve({
                        coords: {
                            latitude: o.position.latitude,
                            longitude: o.position.longitude,
                            accuracy: o.position.accuracy !== undefined ? o.position.accuracy : 20,
                            altitude: o.position.altitude !== undefined ? o.position.altitude : null,
                            altitudeAccuracy:
                                o.position.altitudeAccuracy !== undefined ? o.position.altitudeAccuracy : null,
                            heading: o.position.heading !== undefined ? o.position.heading : null,
                            speed: o.position.speed !== undefined ? o.position.speed : null,
                        },
                        // A number. See above.
                        timestamp: o.position.timestamp !== undefined ? o.position.timestamp : Date.now(),
                    });
                },
            },

            /*
             * The Web API, absent when the host has none.
             *
             * The same switch and the same rejection shape as the dataset rig's,
             * so an assertion reads the same in both: **a rejection is a plain
             * object carrying `errorCode` and `message`, not an `Error`.** A
             * stub that rejected with an `Error` would pass a control that
             * renders the string "[object Object]" where the platform's
             * explanation belongs.
             */
            webAPI: o.webAPI
                ? {
                    createRecord: function (entityType, data) {
                        log('webAPI.createRecord', entityType);

                        var refusal = fails();

                        if (refusal) {
                            return refusal;
                        }

                        if (o.createRecord === null || o.createRecord === undefined) {
                            return Promise.reject({
                                errorCode: 2147746581,
                                message: 'The record could not be created.',
                            });
                        }

                        /*
                         * The platform resolves with an `EntityReference`, whose
                         * `id` is an **object with a `guid` on it**, not a
                         * string — so `String(reference.id)` is "[object
                         * Object]" and the id the control stored is useless.
                         * Reproduced rather than flattened, for that reason.
                         */
                        return Promise.resolve({
                            entityType: entityType,
                            id: { guid: o.createRecord },
                            name: (data && data.subject) || '',
                        });
                    },

                    updateRecord: function (entityType, id, data) {
                        log('webAPI.updateRecord', entityType + ' ' + id + ' ' + Object.keys(data || {}).join(','));

                        var refusal = fails();

                        if (refusal) {
                            return refusal;
                        }

                        if (!o.updateRecord) {
                            return Promise.reject({
                                errorCode: 2147746581,
                                message: 'The record could not be updated.',
                            });
                        }

                        var tables = (fixture && fixture.tables) || {};

                        // A fixture without the table is the older shape: resolve, apply nothing.
                        if (!tables[entityType]) {
                            return Promise.resolve({ entityType: entityType, id: { guid: id }, name: '' });
                        }

                        var outcome = applyUpdate(fixture, entityType, id, data || {}, o);

                        return outcome.failure
                            ? Promise.reject(outcome.failure)
                            : Promise.resolve({ entityType: entityType, id: { guid: id }, name: '' });
                    },

                    retrieveRecord: function (entityType, id, options) {
                        log('webAPI.retrieveRecord', entityType + ' ' + id + ' ' + (options || ''));

                        var refusal = fails();

                        if (refusal) {
                            return refusal;
                        }

                        if (o.retrieveRecord === null || o.retrieveRecord === undefined) {
                            return Promise.reject(webApiFault(2147746581, '', 'The record could not be retrieved.'));
                        }

                        if (o.retrieveRecord !== 'fixture') {
                            return Promise.resolve(o.retrieveRecord);
                        }

                        /*
                         * From the fixture, by id, with `$select` honoured the
                         * way a query's is. An id the fixture does not hold is
                         * the server's "Record Is Unavailable" (0x80040217).
                         */
                        var h = hierarchyOf(fixture, entityType);
                        var rows = ((fixture && fixture.tables) || {})[entityType] || [];
                        var found = rows.filter(function (row) {
                            return bareId(row[h.id]) === bareId(id);
                        })[0];

                        if (!found) {
                            return Promise.reject(webApiFault(
                                2147746327,
                                'Record Is Unavailable',
                                'The requested record was not found or you do not have sufficient permissions to view it.',
                            ));
                        }

                        return answerQuery(
                            fixture,
                            entityType,
                            (options || '?') + (options && options.indexOf('?') !== -1 ? '&' : '') + '$filter=' + h.id + ' eq ' + bareId(id),
                            0,
                            o,
                        ).then(function (result) {
                            return result.entities[0];
                        });
                    },

                    /**
                     * From the fixture — see `answerQuery` for the OData and
                     * FetchXML subsets it reads, what it refuses, and the two
                     * server behaviours it reproduces. `maxPageSize` is the
                     * method's third argument and truncates with a `nextLink`,
                     * which is not what `$top` does; a control that needs the
                     * "there are more" signal has to use the right one.
                     */
                    retrieveMultipleRecords: function (entityType, options, maxPageSize) {
                        log('webAPI.retrieveMultipleRecords', entityType + ' ' + (options || '') + (maxPageSize ? ' max=' + maxPageSize : ''));

                        var refusal = fails();

                        if (refusal) {
                            return refusal;
                        }

                        if (entityType === 'audit' && !o.auditSummary) {
                            // The user without prvReadAuditSummary. The code
                            // is the platform's generic privilege refusal;
                            // pcf-audit-history's SPEC.md P7 records what the
                            // form actually sends.
                            return Promise.reject(webApiFault(2147746323, 'Insufficient Permissions',
                                'Principal user is missing prvReadAuditSummary privilege.'));
                        }

                        return answerQuery(fixture, entityType, options, maxPageSize, o);
                    },
                }
                : undefined,

            /*
             * Navigation, assembled method by method — see `buildNavigation`.
             *
             * Recorded rather than performed: there is nowhere to navigate to
             * here, and what regresses is what the control *handed over*, not
             * the platform's ability to act on it.
             */
            navigation: buildNavigation(o, log),

            /*
             * `context.page` — undocumented, like `contextInfo`, and read for
             * one thing: `getClientUrl()`, the organisation URL a same-origin
             * metadata `fetch` has to start from. Absent on canvas and under
             * `page: false`, which is the state that makes a control write its
             * `Xrm` fallback and then its "no metadata, take the other route"
             * branch.
             */
            page: o.page && o.host !== 'canvas'
                ? {
                    getClientUrl: function () {
                        return clientUrl;
                    },
                }
                : undefined,

            /*
             * `context.utils`, absent on a host without the `Utility` feature.
             *
             * **`getEntityMetadata` resolves with a class instance, not a plain
             * object**, and this reproduces that rather than flattening it: the
             * own enumerable properties are private fields, and the public
             * members are getters on the prototype. Code that walks
             * `Object.keys` sees `_entityDescriptor` and concludes the entity
             * has no entity set, while reading `metadata.EntitySetName` by name
             * works perfectly well — because property *access* traverses the
             * prototype chain and enumeration does not.
             *
             * A flat object here would let that code pass locally and fail on a
             * form, which is the most expensive thing a stub can do.
             */
            utils: o.utils
                ? {
                    getEntityMetadata: function (entityName, attributes) {
                        log('getEntityMetadata', entityName);

                        function Metadata() {
                            // Private fields, and the only things Object.keys sees.
                            this._entityDescriptor = { EntityLogicalName: entityName };
                            // The argument is a *request*, not a result. It reads
                            // exactly like an answer, which is the trap.
                            this._attributes = attributes || [];
                        }

                        /*
                         * From `fixture.entitySets` when it names the table
                         * — a lookup's target has its own set, and a control
                         * that reads `getEntityMetadata(target).EntitySetName`
                         * must get the target's — else the one switch.
                         */
                        Object.defineProperty(Metadata.prototype, 'EntitySetName', {
                            get: function () {
                                var sets = (fixture && fixture.entitySets) || {};

                                return Object.prototype.hasOwnProperty.call(sets, entityName) ? sets[entityName] : o.entitySetName;
                            },
                        });

                        Object.defineProperty(Metadata.prototype, 'PrimaryIdAttribute', {
                            get: function () {
                                return hierarchyOf(fixture, entityName).id;
                            },
                        });

                        Object.defineProperty(Metadata.prototype, 'PrimaryNameAttribute', {
                            get: function () {
                                return o.primaryNameAttribute;
                            },
                        });

                        /*
                         * `Attributes` is an item collection — `get(name)` and
                         * `getAll()`, never a plain object — holding only the
                         * columns the call ASKED for (the second argument),
                         * each with `LogicalName` and `DisplayName` read from
                         * `fixture.labels[entity]`; a column the fixture does
                         * not name is absent from the collection, as one the
                         * server does not know would be. `DisplayName` is a
                         * string here, as pcf-audit-history's SPEC.md P11
                         * records the platform sending it.
                         */
                        Object.defineProperty(Metadata.prototype, 'Attributes', {
                            get: function () {
                                var labels = (fixture && fixture.labels && fixture.labels[entityName]) || {};
                                var items = (attributes || []).filter(function (name) {
                                    return Object.prototype.hasOwnProperty.call(labels, name);
                                }).map(function (name) {
                                    return { LogicalName: name, DisplayName: labels[name] };
                                });

                                return {
                                    get: function (name) {
                                        return items.filter(function (item) { return item.LogicalName === name; })[0];
                                    },
                                    getAll: function () {
                                        return items.slice();
                                    },
                                    getLength: function () {
                                        return items.length;
                                    },
                                };
                            },
                        });

                        return Promise.resolve(new Metadata());
                    },

                    /**
                     * **Synchronous, and returns a boolean.** The only member
                     * of this bag that is not a promise, which is easy to miss
                     * beside `getEntityMetadata` and produces a control that
                     * gates on a truthy `Promise` and therefore never gates at
                     * all.
                     *
                     * The arguments are numeric enums, not strings:
                     * `PrivilegeType` is 0 None, 1 Create, 2 Read, 3 Write,
                     * 4 Delete, 5 Assign, 6 Share, 7 Append, 8 AppendTo;
                     * `PrivilegeDepth` is -1 None, 0 Basic, 1 Local, 2 Deep,
                     * 3 Global. Both are logged so an assertion can be about
                     * which privilege the control actually asked for — passing
                     * Read where Write was meant is invisible otherwise,
                     * because almost every user has Read.
                     */
                    /**
                     * The platform's lookup dialog. Logged in full — the
                     * options handed over are the decision — and resolved
                     * from `o.lookupPick`, braced and upper-cased the way the
                     * platform hands a pick over; `[]` for a cancel, which is
                     * the default. Absent under `lookupObjects: false` while
                     * `utils` stays.
                     */
                    lookupObjects: o.lookupObjects
                        ? function (lookupOptions) {
                            log('utils.lookupObjects', lookupOptions);

                            var pick = o.lookupPick;

                            return Promise.resolve(pick
                                ? [{
                                    id: '{' + String(pick.id).toUpperCase() + '}',
                                    entityType: pick.entityType,
                                    name: pick.name,
                                }]
                                : []);
                        }
                        : undefined,

                    hasEntityPrivilege: function (entityTypeName, privilegeType, privilegeDepth) {
                        log('utils.hasEntityPrivilege', {
                            entityTypeName: entityTypeName,
                            privilegeType: privilegeType,
                            privilegeDepth: privilegeDepth,
                        });

                        if (!o.utilityDeclared) {
                            throw new Error("Feature 'Utility.hasEntityPrivilege' is required to be specified in the <uses-feature> section in ControlManifest.xml before use.");
                        }

                        return Boolean(o.hasPrivilege);
                    },
                }
                : undefined,

            /*
             * The event bag, or nothing at all.
             *
             * `undefined` is a real host: the platform types promise this
             * member unconditionally, and neither the manifest nor the
             * generated types are evidence that a name declared in the manifest
             * arrives here as a callable. A control that feature-detects passes
             * both ways; one that does not fails on the host it was never run
             * on.
             *
             * **Two shapes, and the second one is the point.** An array of
             * names binds each to a logger, which is all a canvas-shaped event
             * needs — there is no Power Fx here to run. An object of
             * `name -> function` binds the caller's own handler *as well as*
             * the logger, which is what a model-driven event needs, because
             * `addEventHandler` hands the handler a payload and the payload can
             * carry callbacks the handler calls straight back into the control.
             * A rig that could only log could never exercise the half of that
             * contract the control implements.
             *
             * The handler runs **after** the log entry, so `calls` records the
             * raise in the order it happened even when the handler re-enters
             * the control.
             */
            events: buildEvents(o.events, log),

            /*
             * Absent on a host that publishes no theme, which is what the
             * control's `applyTheme` is written for: `isDarkTheme === undefined`
             * means take no position and let the stylesheet's own fallbacks
             * stand.
             */
            fluentDesignLanguage: host.publishesTheme ? { isDarkTheme: Boolean(o.dark) } : undefined,

            userSettings: {
                isRTL: o.rtl,
                languageId: o.languageId,
                userId: o.userId,
                userName: o.userName,
                // Read by any control that formats a number or a date.
                numberFormattingInfo: { numberDecimalSeparator: '.', numberGroupSeparator: ',' },
            },

            client: {
                getClient: function () {
                    return o.formFactor === 'phone' || o.formFactor === 'tablet' ? 'Mobile' : 'Web';
                },
                getFormFactor: function () {
                    return FORM_FACTORS[o.formFactor] !== undefined ? FORM_FACTORS[o.formFactor] : 1;
                },
                isOffline: function () {
                    return o.offline;
                },
            },

            /*
             * `updatedProperties` is how the platform says *what* changed since
             * the last pass, and it is the cheap way out of doing work on every
             * `updateView`. Empty unless a caller sets it, because that is what
             * the first call carries.
             */
            updatedProperties: o.updatedProperties || [],
        };
    }

    /**
     * Capture the constructor the bundle registers when it loads.
     *
     * `pcf-scripts` emits `registerControl('PCF.CodeEditor', ctor)`
     * — **two arguments**, the namespace and the constructor name already
     * joined into one string. Reading the constructor from a third parameter
     * gets `undefined`, and the failure surfaces later as "registered is not a
     * constructor" rather than here.
     */
    function captureRegistration(global) {
        var box = { name: null, ctor: null };

        global.ComponentFramework = global.ComponentFramework || {};
        global.ComponentFramework.registerControl = function (fullName, ctor) {
            box.name = fullName;
            box.ctor = ctor;
        };

        return box;
    }

    return {
        HOSTS: HOSTS,
        SECURITY: SECURITY,
        STRINGS: STRINGS,
        DEFAULTS: DEFAULTS,
        FORM_FACTORS: FORM_FACTORS,
        createContext: createContext,
        captureRegistration: captureRegistration,
        nextClientUrl: nextClientUrl,
        clientUrlFor: clientUrlFor,
        answerQuery: answerQuery,
        webApiFault: webApiFault,
    };
});
