import { model, Schema } from 'mongoose'

export const TransactionSchema = new Schema({
    txid: { type: String, index: true, unique: true, required: true, lowercase: true },
    height: { type: Number, index: true, min: 0},
    data: { type: String, required: true },
    addresses: { type: [String], index: true },
}, { _id: false } )

export const TransactionModel = model('Transaction', TransactionSchema, 'tx')