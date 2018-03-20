'use strict';

const _get = require('lodash.get');

const {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLList,
  GraphQLInt,
  GraphQLFloat,
  GraphQLString,
  GraphQLBoolean,
  GraphQLID
} = require('graphql');

const { EntrySysType, EntryType, CollectionMetaType } = require('./base-types.js');
const typeFieldConfigMap = require('./field-config.js');
const createBackrefsType = require('./backref-types.js');

module.exports = {
  createSchema,
  createQueryType,
  createQueryFields
};

function createSchema(spaceGraph, queryTypeName) {
  return new GraphQLSchema({
    query: createQueryType(spaceGraph, queryTypeName)
  });
}

function createQueryType(spaceGraph, name = 'Query') {
  return new GraphQLObjectType({
    name,
    fields: createQueryFields(spaceGraph)
  });
}

function createQueryFields(spaceGraph) {
  const ctIdToType = {};
  const extraArgs = ['slug', 'code', 'name', 'key'];

  return spaceGraph.reduce((acc, ct) => {
    const defaultFieldsThunk = () => {
      const fields = { sys: { type: EntrySysType } };
      const BackrefsType = createBackrefsType(ct, ctIdToType);
      if (BackrefsType) {
        fields._backrefs = { type: BackrefsType, resolve: e => e.sys.id };
      }
      return fields;
    };

    const fieldsThunk = () => ct.fields.reduce((acc, f) => {
      acc[f.id] = typeFieldConfigMap[f.type](f, ctIdToType);
      return acc;
    }, defaultFieldsThunk());

    const hasField = (name) => {
      return ct.fields.find(o => o.id === name)
    }

    const isOwnField = (f) => {
      const t = f.type;
      return t === "String" ||
        t === "Int" ||
        t === "Float" ||
        t === "Bool";
    }

    const Type = ctIdToType[ct.id] = new GraphQLObjectType({
      name: ct.names.type,
      interfaces: [EntryType],
      fields: fieldsThunk,
      isTypeOf: entry => {
        const ctId = _get(entry, ['sys', 'contentType', 'sys', 'id']);
        return ctId === ct.id;
      }
    });

    // one
    const entry = acc[ct.names.field] = {
      type: Type,
      args: {
        id: { type: GraphQLID },
        locale: { type: GraphQLString }
      },
      resolve: (_, args, ctx) => ctx.entryLoader.get(ct.id, args)
    };

    // many
    const list = acc[ct.names.collectionField] = {
      type: new GraphQLList(Type),
      args: {
        q: { type: GraphQLString },
        skip: { type: GraphQLInt },
        limit: { type: GraphQLInt },
        include: { type: GraphQLInt },
        locale: { type: GraphQLString }
      },
      resolve: (_, args, ctx) => ctx.entryLoader.query(ct.id, args)
    };

    // append additional args to one
    extraArgs.forEach(a => {
      if (hasField(a)) {
        // console.log(`${ct.names.collectionField} has field ${a}`)
        entry.args[a] = { type: GraphQLString }
      }
    })
    // append additional fields to many
    ct.fields.forEach(a => {
      const t = isOwnField(a)
      if (t) {
        list.args[a.id] = { type: GraphQLString }
      }
    })

    acc[`_${ct.names.collectionField}Meta`] = {
      type: CollectionMetaType,
      args: { q: { type: GraphQLString } },
      resolve: (_, args, ctx) => ctx.entryLoader.count(ct.id, args).then(count => ({ count }))
    };

    return acc;
  }, {});
}
