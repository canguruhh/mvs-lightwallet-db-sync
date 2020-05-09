import { model, Schema, Document } from 'mongoose'

export const BlockSchema: Schema<IBlock>  = new Schema({
    
    hash: { type: String, index: true, unique: true, required: true, lowercase: true },
    previous_block: { type: String, index: true, required: true, lowercase: true },

    number: { type: Number, index: true, min: 0, required: true, },
    
    transaction_count: { type: Number, required: true },
    transactions: { type: [String], index: true, required: true },

}, {_id: false})

export interface IBlock extends Document {
    hash: string;
    previous_block: string;
    number: number;
    transaction_count: number;
    transactions: string[];
}

export const BlockModel = model<IBlock>('Block', BlockSchema, 'block')
