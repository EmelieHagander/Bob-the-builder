-- Owner decision 2026-11-02 (thread "Fix Bob rambling in Ladan chat"): the
-- early 2D concept model gets the same typed, strict changes as design features
-- (bob-typed-design-items-v1). Starting the model, adding nodes, components,
-- views and constraints, and replacing a node are typed ops; their shapes no
-- longer live only in the tool text. Catalog only; the server rejects the old
-- raw paths for these operations. Konrad's two construction tools get the same
-- items inside solution_edit (they kept the untyped items after #408).
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_typed_concept$
declare
 spec constant jsonb:=$bob_typed_concept_spec$
{
 "keys": [
  "tools.edit_project_record",
  "tools.create_solution_alternative"
 ],
 "old_items": {
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
   },
   {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "op": {
      "type": "string",
      "enum": [
       "set_concept_model"
      ]
     },
     "model": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
       "version": {
        "type": "integer",
        "enum": [
         1
        ]
       },
       "frame": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
         "origin": {
          "type": "string"
         },
         "x": {
          "type": "string"
         },
         "y": {
          "type": "string"
         },
         "z": {
          "type": "string"
         }
        },
        "required": [
         "origin",
         "x",
         "y",
         "z"
        ]
       },
       "nodes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "items": {
         "anyOf": [
          {
           "type": "object",
           "additionalProperties": false,
           "properties": {
            "id": {
             "type": "string",
             "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
            },
            "role": {
             "type": "string",
             "enum": [
              "decision",
              "estimate"
             ]
            },
            "value": {
             "type": "number"
            },
            "unit": {
             "type": "string",
             "enum": [
              "mm",
              "scalar"
             ]
            },
            "reason": {
             "type": "string"
            }
           },
           "required": [
            "id",
            "role",
            "value",
            "unit",
            "reason"
           ]
          },
          {
           "type": "object",
           "additionalProperties": false,
           "properties": {
            "id": {
             "type": "string",
             "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
            },
            "role": {
             "type": "string",
             "enum": [
              "unknown"
             ]
            },
            "unit": {
             "type": "string",
             "enum": [
              "mm",
              "scalar"
             ]
            },
            "reason": {
             "type": "string"
            }
           },
           "required": [
            "id",
            "role",
            "unit",
            "reason"
           ]
          },
          {
           "type": "object",
           "additionalProperties": false,
           "properties": {
            "id": {
             "type": "string",
             "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
            },
            "role": {
             "type": "string",
             "enum": [
              "derived"
             ]
            },
            "operation": {
             "type": "string",
             "enum": [
              "add_v1",
              "subtract_v1",
              "multiply_v1",
              "divide_v1"
             ]
            },
            "operands": {
             "type": "array",
             "minItems": 2,
             "maxItems": 2,
             "items": {
              "type": "string"
             }
            },
            "rounding": {
             "type": "string",
             "enum": [
              "exact",
              "half_away_6"
             ]
            }
           },
           "required": [
            "id",
            "role",
            "operation",
            "operands",
            "rounding"
           ]
          }
         ]
        }
       },
       "components": {
        "type": "array",
        "minItems": 1,
        "maxItems": 48,
        "items": {
         "type": "object",
         "additionalProperties": false,
         "properties": {
          "id": {
           "type": "string",
           "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
          },
          "label": {
           "type": "string"
          },
          "kind": {
           "type": "string",
           "enum": [
            "solid",
            "space",
            "opening"
           ]
          },
          "active": {
           "type": "boolean"
          },
          "position": {
           "type": "array",
           "minItems": 3,
           "maxItems": 3,
           "items": {
            "type": "string"
           },
           "description": "Node ids for x, y and z."
          },
          "size": {
           "type": "array",
           "minItems": 3,
           "maxItems": 3,
           "items": {
            "type": "string"
           },
           "description": "Node ids for x, y and z."
          },
          "features": {
           "type": "array",
           "items": {
            "type": "string"
           },
           "description": "Feature ids from concept_links."
          },
          "choices": {
           "type": "array",
           "items": {
            "type": "string"
           },
           "description": "Choice ids from concept_links."
          }
         },
         "required": [
          "id",
          "label",
          "kind",
          "active",
          "position",
          "size",
          "features",
          "choices"
         ]
        }
       },
       "views": {
        "type": "array",
        "minItems": 2,
        "maxItems": 6,
        "items": {
         "type": "object",
         "additionalProperties": false,
         "properties": {
          "id": {
           "type": "string",
           "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
          },
          "label": {
           "type": "string"
          },
          "plane": {
           "type": "string",
           "enum": [
            "XY",
            "XZ",
            "YZ"
           ]
          },
          "kind": {
           "type": "string",
           "enum": [
            "projection",
            "section"
           ]
          },
          "at": {
           "type": [
            "string",
            "null"
           ],
           "description": "Node id of the perpendicular coordinate for a section; null for a projection."
          }
         },
         "required": [
          "id",
          "label",
          "plane",
          "kind",
          "at"
         ]
        }
       },
       "constraints": {
        "type": "array",
        "maxItems": 24,
        "items": {
         "anyOf": [
          {
           "type": "object",
           "additionalProperties": false,
           "properties": {
            "id": {
             "type": "string",
             "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
            },
            "label": {
             "type": "string"
            },
            "relation": {
             "type": "string",
             "enum": [
              "equal",
              "at_most"
             ]
            },
            "left": {
             "type": "string"
            },
            "right": {
             "type": "string"
            },
            "feature": {
             "type": [
              "string",
              "null"
             ]
            }
           },
           "required": [
            "id",
            "label",
            "relation",
            "left",
            "right",
            "feature"
           ]
          },
          {
           "type": "object",
           "additionalProperties": false,
           "properties": {
            "id": {
             "type": "string",
             "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
            },
            "label": {
             "type": "string"
            },
            "relation": {
             "type": "string",
             "enum": [
              "view_plane"
             ]
            },
            "view": {
             "type": "string"
            },
            "plane": {
             "type": "string",
             "enum": [
              "XY",
              "XZ",
              "YZ"
             ]
            },
            "feature": {
             "type": [
              "string",
              "null"
             ]
            }
           },
           "required": [
            "id",
            "label",
            "relation",
            "view",
            "plane",
            "feature"
           ]
          }
         ]
        }
       },
       "unsupported": {
        "type": "array",
        "maxItems": 12,
        "items": {
         "type": "string"
        }
       }
      },
      "required": [
       "version",
       "frame",
       "nodes",
       "components",
       "views",
       "constraints",
       "unsupported"
      ]
     }
    },
    "required": [
     "op",
     "model"
    ]
   },
   {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "op": {
      "type": "string",
      "enum": [
       "add_concept_node"
      ]
     },
     "node": {
      "anyOf": [
       {
        "type": "object",
        "additionalProperties": false,
        "properties": {
         "id": {
          "type": "string",
          "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
         },
         "role": {
          "type": "string",
          "enum": [
           "decision",
           "estimate"
          ]
         },
         "value": {
          "type": "number"
         },
         "unit": {
          "type": "string",
          "enum": [
           "mm",
           "scalar"
          ]
         },
         "reason": {
          "type": "string"
         }
        },
        "required": [
         "id",
         "role",
         "value",
         "unit",
         "reason"
        ]
       },
       {
        "type": "object",
        "additionalProperties": false,
        "properties": {
         "id": {
          "type": "string",
          "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
         },
         "role": {
          "type": "string",
          "enum": [
           "unknown"
          ]
         },
         "unit": {
          "type": "string",
          "enum": [
           "mm",
           "scalar"
          ]
         },
         "reason": {
          "type": "string"
         }
        },
        "required": [
         "id",
         "role",
         "unit",
         "reason"
        ]
       },
       {
        "type": "object",
        "additionalProperties": false,
        "properties": {
         "id": {
          "type": "string",
          "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
         },
         "role": {
          "type": "string",
          "enum": [
           "derived"
          ]
         },
         "operation": {
          "type": "string",
          "enum": [
           "add_v1",
           "subtract_v1",
           "multiply_v1",
           "divide_v1"
          ]
         },
         "operands": {
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {
           "type": "string"
          }
         },
         "rounding": {
          "type": "string",
          "enum": [
           "exact",
           "half_away_6"
          ]
         }
        },
        "required": [
         "id",
         "role",
         "operation",
         "operands",
         "rounding"
        ]
       }
      ]
     }
    },
    "required": [
     "op",
     "node"
    ]
   },
   {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "op": {
      "type": "string",
      "enum": [
       "replace_concept_node"
      ]
     },
     "index": {
      "type": "integer"
     },
     "node": {
      "anyOf": [
       {
        "type": "object",
        "additionalProperties": false,
        "properties": {
         "id": {
          "type": "string",
          "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
         },
         "role": {
          "type": "string",
          "enum": [
           "decision",
           "estimate"
          ]
         },
         "value": {
          "type": "number"
         },
         "unit": {
          "type": "string",
          "enum": [
           "mm",
           "scalar"
          ]
         },
         "reason": {
          "type": "string"
         }
        },
        "required": [
         "id",
         "role",
         "value",
         "unit",
         "reason"
        ]
       },
       {
        "type": "object",
        "additionalProperties": false,
        "properties": {
         "id": {
          "type": "string",
          "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
         },
         "role": {
          "type": "string",
          "enum": [
           "unknown"
          ]
         },
         "unit": {
          "type": "string",
          "enum": [
           "mm",
           "scalar"
          ]
         },
         "reason": {
          "type": "string"
         }
        },
        "required": [
         "id",
         "role",
         "unit",
         "reason"
        ]
       },
       {
        "type": "object",
        "additionalProperties": false,
        "properties": {
         "id": {
          "type": "string",
          "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
         },
         "role": {
          "type": "string",
          "enum": [
           "derived"
          ]
         },
         "operation": {
          "type": "string",
          "enum": [
           "add_v1",
           "subtract_v1",
           "multiply_v1",
           "divide_v1"
          ]
         },
         "operands": {
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {
           "type": "string"
          }
         },
         "rounding": {
          "type": "string",
          "enum": [
           "exact",
           "half_away_6"
          ]
         }
        },
        "required": [
         "id",
         "role",
         "operation",
         "operands",
         "rounding"
        ]
       }
      ]
     }
    },
    "required": [
     "op",
     "index",
     "node"
    ]
   },
   {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "op": {
      "type": "string",
      "enum": [
       "add_concept_component"
      ]
     },
     "component": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
       "id": {
        "type": "string",
        "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
       },
       "label": {
        "type": "string"
       },
       "kind": {
        "type": "string",
        "enum": [
         "solid",
         "space",
         "opening"
        ]
       },
       "active": {
        "type": "boolean"
       },
       "position": {
        "type": "array",
        "minItems": 3,
        "maxItems": 3,
        "items": {
         "type": "string"
        },
        "description": "Node ids for x, y and z."
       },
       "size": {
        "type": "array",
        "minItems": 3,
        "maxItems": 3,
        "items": {
         "type": "string"
        },
        "description": "Node ids for x, y and z."
       },
       "features": {
        "type": "array",
        "items": {
         "type": "string"
        },
        "description": "Feature ids from concept_links."
       },
       "choices": {
        "type": "array",
        "items": {
         "type": "string"
        },
        "description": "Choice ids from concept_links."
       }
      },
      "required": [
       "id",
       "label",
       "kind",
       "active",
       "position",
       "size",
       "features",
       "choices"
      ]
     }
    },
    "required": [
     "op",
     "component"
    ]
   },
   {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "op": {
      "type": "string",
      "enum": [
       "add_concept_view"
      ]
     },
     "view": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
       "id": {
        "type": "string",
        "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
       },
       "label": {
        "type": "string"
       },
       "plane": {
        "type": "string",
        "enum": [
         "XY",
         "XZ",
         "YZ"
        ]
       },
       "kind": {
        "type": "string",
        "enum": [
         "projection",
         "section"
        ]
       },
       "at": {
        "type": [
         "string",
         "null"
        ],
        "description": "Node id of the perpendicular coordinate for a section; null for a projection."
       }
      },
      "required": [
       "id",
       "label",
       "plane",
       "kind",
       "at"
      ]
     }
    },
    "required": [
     "op",
     "view"
    ]
   },
   {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "op": {
      "type": "string",
      "enum": [
       "add_concept_constraint"
      ]
     },
     "constraint": {
      "anyOf": [
       {
        "type": "object",
        "additionalProperties": false,
        "properties": {
         "id": {
          "type": "string",
          "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
         },
         "label": {
          "type": "string"
         },
         "relation": {
          "type": "string",
          "enum": [
           "equal",
           "at_most"
          ]
         },
         "left": {
          "type": "string"
         },
         "right": {
          "type": "string"
         },
         "feature": {
          "type": [
           "string",
           "null"
          ]
         }
        },
        "required": [
         "id",
         "label",
         "relation",
         "left",
         "right",
         "feature"
        ]
       },
       {
        "type": "object",
        "additionalProperties": false,
        "properties": {
         "id": {
          "type": "string",
          "description": "Local id: letters, digits, underscore or hyphen, starting with a letter, max 32."
         },
         "label": {
          "type": "string"
         },
         "relation": {
          "type": "string",
          "enum": [
           "view_plane"
          ]
         },
         "view": {
          "type": "string"
         },
         "plane": {
          "type": "string",
          "enum": [
           "XY",
           "XZ",
           "YZ"
          ]
         },
         "feature": {
          "type": [
           "string",
           "null"
          ]
         }
        },
        "required": [
         "id",
         "label",
         "relation",
         "view",
         "plane",
         "feature"
        ]
       }
      ]
     }
    },
    "required": [
     "op",
     "constraint"
    ]
   }
  ]
 },
 "description": {
  "key": "tools.edit_project_record",
  "old": " Early 2D design uses optional /design_intent/model on this same Solution, before target selection. Initialize once with {version:1,frame:{origin,x,y,z} (plain axis descriptions),nodes,components,views,constraints,unsupported:[]}. Nodes reuse CAD parameters: {id,role:decision|estimate,value,unit:mm|scalar,reason}, {id,role:unknown,unit,reason}, or {id,role:derived,operation:add_v1|subtract_v1|multiply_v1|divide_v1,operands:[id,id],rounding:exact|half_away_6}. No measured/source nodes. Components: {id,label,kind:solid|space|opening,active:true,position:[node,node,node],size:[node,node,node],features:[feature_id],choices:[choice_id]}. Views: {id,label,plane:XY|XZ|YZ,kind:projection|section,at:null|node}; include an XY projection and a profile; section at names the perpendicular coordinate. Constraints: {id,label,relation:equal|at_most,left:node,right:node,feature:null|feature_id}. View requirements use constraints {id,label,relation:view_plane,view:view_id,plane:XY|XZ|YZ,feature:null|feature_id}. Use returned concept_links. IDs are local letters/digits/underscore/hyphen, start with a letter, max 32. Subsequent changes set /design_intent/model/<nodes|components|views|constraints>/<index>/<field>, append at /-, or set frame/unsupported. Node content may be replaced at its index with the SAME id. Components deactivate via active=false; do not replace lists or identities. Unknowns/conflicts stay saved and visible. Every view derives from this model; openings are annotated volumes, not boolean cuts. Unsupported forms belong in unsupported. Saving is not construction or safety approval.",
  "new": " Early 2D design uses an optional concept model on this same Solution, before target selection. Start it once with set_concept_model; extend it with add_concept_node, add_concept_component, add_concept_view or add_concept_constraint; replace a node with replace_concept_node at its index, keeping the same id. No measured/source nodes. Include an XY projection and a profile view; a section names its perpendicular coordinate in at. Components and constraints link features and choices through the returned concept_links. Change single fields at /design_intent/model/<nodes|components|views|constraints>/<index>/<field>, or set /design_intent/model/frame or /design_intent/model/unsupported. Components deactivate via active=false; do not replace lists or identities. Unknowns/conflicts stay saved and visible. Every view derives from this model; openings are annotated volumes, not boolean cuts. Unsupported forms belong in unsupported. Saving is not construction or safety approval."
 },
 "construction_keys": [
  "tools.edit_construction_parts",
  "tools.change_construction_parameters"
 ],
 "construction_old_items": {
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
 }
}
$bob_typed_concept_spec$::jsonb;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid; key text; def jsonb; activations jsonb:='{}'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 for key in select jsonb_array_elements_text(spec->'keys') loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=key and p.retired_at is null for update of p;
  if not found then raise exception 'bob_typed_concept_missing %',key; end if;
  if prior.metadata->>'typed_concept_version'='1' then continue; end if;
  if prior.definition#>'{parameters,properties,changes,items}' is distinct from spec->'old_items' or prior.definition->'strict' is distinct from 'true'::jsonb then raise exception 'bob_typed_concept_unexpected_schema %',key; end if;
  def:=jsonb_set(prior.definition,'{parameters,properties,changes,items}',spec->'items');
  if key=spec#>>'{description,key}' then
   if (length(def->>'description')-length(replace(def->>'description',spec#>>'{description,old}','')))/length(spec#>>'{description,old}')<>1 then raise exception 'bob_typed_concept_unexpected_description'; end if;
   def:=jsonb_set(def,'{description}',to_jsonb(replace(def->>'description',spec#>>'{description,old}',spec#>>'{description,new}')));
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-typed-concept-items-v1','typed_concept_version',1),
    prior.content,def,prior.flow,prior.available_variables) returning id into version_uuid;
  activations:=activations||jsonb_build_object(key,version_uuid);
 end loop;
 -- Konrad's construction tools reuse the same changes inside solution_edit.
 for key in select jsonb_array_elements_text(spec->'construction_keys') loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=key and p.retired_at is null for update of p;
  if not found then raise exception 'bob_typed_concept_missing %',key; end if;
  if prior.metadata->>'typed_concept_version'='1' then continue; end if;
  if prior.definition#>'{parameters,properties,solution_edit,anyOf,0,properties,changes,items}' is distinct from spec->'construction_old_items' then raise exception 'bob_typed_concept_unexpected_schema %',key; end if;
  def:=jsonb_set(prior.definition,'{parameters,properties,solution_edit,anyOf,0,properties,changes,items}',spec->'items');
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-typed-concept-items-v1','typed_concept_version',1),
    prior.content,def,prior.flow,prior.available_variables) returning id into version_uuid;
  activations:=activations||jsonb_build_object(key,version_uuid);
 end loop;
 if activations<>'{}'::jsonb then perform shared.activate_ai_catalog('bob',activations); end if;
end $bob_typed_concept$;
commit;
