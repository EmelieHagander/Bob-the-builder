-- Owner decision 2026-11-02 (thread "Fix Bob rambling in Ladan chat"): a new
-- design feature or choice is a typed change (op add_feature / add_choice), and
-- the two Solution write tools become strict, so the provider enforces the item
-- shape before the call. Before, the shape lived only in the server validator
-- and Bob's guessed value_json was rejected ten times in Ladan. Catalog only;
-- the server rejects the old raw /features/- and /choices/- append paths.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_typed_items$
declare
 spec constant jsonb:=$bob_typed_items_spec$
{
 "keys": [
  "tools.edit_project_record",
  "tools.create_solution_alternative"
 ],
 "old_items": {
  "type": "object",
  "required": [
   "op",
   "path",
   "value_json"
  ],
  "properties": {
   "op": {
    "enum": [
     "set",
     "append_text",
     "remove"
    ],
    "type": "string"
   },
   "path": {
    "type": "string"
   },
   "value_json": {
    "type": [
     "string",
     "null"
    ],
    "description": "JSON-encoded new value. null only for remove. append_text appends the decoded string verbatim."
   }
  },
  "additionalProperties": false
 },
 "items": {
  "anyOf": [
   {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "op": {
      "type": "string",
      "enum": [
       "set",
       "append_text",
       "remove"
      ]
     },
     "path": {
      "type": "string"
     },
     "value_json": {
      "type": [
       "string",
       "null"
      ],
      "description": "JSON-encoded new value. null only for remove. append_text appends the decoded string verbatim."
     }
    },
    "required": [
     "op",
     "path",
     "value_json"
    ]
   },
   {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "op": {
      "type": "string",
      "enum": [
       "add_feature"
      ]
     },
     "feature": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
       "description": {
        "type": "string"
       },
       "basis": {
        "type": "string",
        "enum": [
         "user_request",
         "project_record",
         "working_assumption"
        ]
       }
      },
      "required": [
       "description",
       "basis"
      ]
     }
    },
    "required": [
     "op",
     "feature"
    ]
   },
   {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "op": {
      "type": "string",
      "enum": [
       "add_choice"
      ]
     },
     "choice": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
       "question": {
        "type": "string"
       },
       "alternatives": {
        "type": "array",
        "maxItems": 4,
        "items": {
         "type": "string"
        }
       },
       "recommendation": {
        "type": "string"
       },
       "basis": {
        "type": "string"
       },
       "consequences": {
        "type": "string"
       },
       "geometry_dependency": {
        "type": "boolean"
       },
       "status": {
        "type": "string",
        "enum": [
         "open",
         "resolved",
         "deferred"
        ]
       },
       "selected_direction": {
        "type": [
         "string",
         "null"
        ],
        "description": "The chosen alternative when resolved; otherwise null."
       },
       "decision_authority": {
        "type": "string",
        "enum": [
         "owner",
         "bob"
        ]
       },
       "decision_basis": {
        "type": "string"
       },
       "deferral": {
        "anyOf": [
         {
          "type": "object",
          "additionalProperties": false,
          "properties": {
           "scope": {
            "type": "string",
            "enum": [
             "illustration",
             "concept"
            ]
           },
           "reason": {
            "type": "string"
           }
          },
          "required": [
           "scope",
           "reason"
          ]
         },
         {
          "type": "null"
         }
        ],
        "description": "Only when deferred; otherwise null."
       }
      },
      "required": [
       "question",
       "alternatives",
       "recommendation",
       "basis",
       "consequences",
       "geometry_dependency",
       "status",
       "selected_direction",
       "decision_authority",
       "decision_basis",
       "deferral"
      ]
     }
    },
    "required": [
     "op",
     "choice"
    ]
   }
  ]
 },
 "description": {
  "key": "tools.edit_project_record",
  "old": "Append a feature or choice at /design_intent/features/- or /design_intent/choices/- without id (feature source_ref is server-owned).",
  "new": "Add a new feature or choice with op add_feature or add_choice; the server assigns its identity and source link."
 }
}
$bob_typed_items_spec$::jsonb;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid; key text; def jsonb; activations jsonb:='{}'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 for key in select jsonb_array_elements_text(spec->'keys') loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=key and p.retired_at is null for update of p;
  if not found then raise exception 'bob_typed_items_missing %',key; end if;
  if prior.metadata->>'typed_items_version'='1' then continue; end if;
  if prior.definition#>'{parameters,properties,changes,items}' is distinct from spec->'old_items' then raise exception 'bob_typed_items_unexpected_schema %',key; end if;
  def:=jsonb_set(prior.definition,'{parameters,properties,changes,items}',spec->'items')||'{"strict":true}'::jsonb;
  if key=spec#>>'{description,key}' then
   if (length(def->>'description')-length(replace(def->>'description',spec#>>'{description,old}','')))/length(spec#>>'{description,old}')<>1 then raise exception 'bob_typed_items_unexpected_description'; end if;
   def:=jsonb_set(def,'{description}',to_jsonb(replace(def->>'description',spec#>>'{description,old}',spec#>>'{description,new}')));
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-typed-design-items-v1','typed_items_version',1),
    prior.content,def,prior.flow,prior.available_variables) returning id into version_uuid;
  activations:=activations||jsonb_build_object(key,version_uuid);
 end loop;
 if activations<>'{}'::jsonb then perform shared.activate_ai_catalog('bob',activations); end if;
end $bob_typed_items$;
commit;
