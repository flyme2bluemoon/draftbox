# Draftbox domain

This context defines the language used for HTML artifacts managed and published by Draftbox.

## Language

**Artifact**:
A logical HTML document managed by Draftbox. An **Artifact** has editable metadata, one **Owner**, and one or more **Versions**.
_Avoid_: file, document, when referring to the managed object rather than uploaded bytes

**Artifact ID**:
An immutable random identifier used by an **Owner** to manage an **Artifact**. It is distinct from the **Share Secret** and does not appear in public links.

**Artifact Metadata**:
The current filename and description of an **Artifact**. It belongs to the **Artifact**, not to an individual **Version**.

**Version**:
The immutable bytes from one upload to an **Artifact**. Uploading new bytes creates a new **Version** rather than changing an existing one.

**Upload Source**:
The machine and canonical local path from which a **Version** was uploaded. Draftbox stores only a hash of this identity and uses it, within an **Owner**'s artifacts, to treat another upload from the same source as a new **Version** of the existing **Artifact**.

**Version Number**:
An artifact-scoped, monotonically increasing identifier written as `vN`. It starts at `v1` and is never reused after a **Version** is deleted.

**Current Version**:
The surviving **Version** with the highest **Version Number**. The **Artifact Link** resolves to this version.

**Owner**:
The WorkOS user who may inspect, change, version, rotate links for, or delete an **Artifact**. Every **Artifact** has exactly one **Owner**.

**Share Secret**:
The random bearer value in an **Artifact Link** and its **Version Links**. Anyone who possesses it may view the referenced content, and rotating it invalidates every link containing the previous value.

**Artifact Link**:
The public link `/p/{random-secret}` that resolves to an **Artifact**'s **Current Version**.
_Avoid_: permalink

**Version Link**:
The public link `/p/{random-secret}/vN` that resolves to one immutable **Version**.

## Relationships

- An **Owner** may own many **Artifacts**.
- An **Artifact** belongs to exactly one **Owner**.
- An **Artifact** has one or more **Versions** while it exists.
- A **Version** records the hashed identity of its **Upload Source**.
- An **Artifact** has exactly one **Current Version**.
- An **Artifact Link** and all related **Version Links** contain the same **Share Secret**.
