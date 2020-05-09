import { connect, disconnect, startSession, ClientSession } from 'mongoose'
import { BlockModel, } from './model/block'
import { MvsdJSONRPC } from 'mvsd'
import { TransactionModel } from './model/transaction'
import { Block, Transaction } from 'metaverse-ts'
import { flatten, uniq, compact } from 'lodash'

const MONGODB_URL = process.env.MONGODB_URL
const MVSD_URL = process.env.MVSD_URL

// optionally enable the removal of the latest block
const REMOVE_BEST_BLOCK = process.env.REMOVE_BEST_BLOCK

const rpc = new MvsdJSONRPC(MVSD_URL)
let lastBlockHash: string

(async () => {
    console.log('starting metaverse sync')
    await connect(MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true, useFindAndModify: false })
    console.info('database connection established')
    console.log('create indexes')
    await BlockModel.ensureIndexes()
    await TransactionModel.ensureIndexes()

    console.log('indexes created')

    let number = (await BlockModel.findOne().sort({ number: -1 }))?.number || 0
    if (number && REMOVE_BEST_BLOCK) {
        console.log('remove best block to make sure the data is clean')
        applyFork(number)
    }

    while (true) {
        number = await syncBlock(number)
        if (!number) {
            console.error('fatal sync error. shutting down')
            process.exit(1)
        }
    }

    await disconnect()
})()

function sleep(millis: number) {
    return new Promise(resolve => {
        setTimeout(() => resolve(), millis)
    })
}

async function syncBlock(number: number) {
    // get block data
    console.debug(`get block number ${number}`)

    const mvsdBlockData = await rpc.getblock({ number }).toPromise()
    if (!mvsdBlockData) {
        await sleep(2000)
        return number
    }

    // fork check
    if (number > 0) {
        const previousBlockHash = lastBlockHash || (await BlockModel.findOne({ number: number - 1 })).hash
        if (!previousBlockHash) {
            throw Error('previous block not found')
        }
        if (previousBlockHash !== mvsdBlockData.previous_block_hash) {
            lastBlockHash = undefined
            console.warn(`found fork will remove block ${number - 1}`)
            await applyFork(number - 1)
            return number - 1
        }
    }

    // get raw block data and decode it to get the transaction data
    const encodedBlock = await rpc.getblock_encoded({ number }).toPromise()
    const decodedBlock = Block.decode(encodedBlock)
    const block = prepareBlock(decodedBlock, encodedBlock)

    // parse transactions data
    if (mvsdBlockData.transactions.length !== decodedBlock.transactions.length) {
        throw Error('Transaction quantity mismatch on block ' + mvsdBlockData.hash)
    }
    const transactions = mvsdBlockData.transactions.map((tx, i) => prepareTransaction(decodedBlock.transactions[i], tx, decodedBlock.header.number))

    // write to database
    const session = await startSession()
    await session.startTransaction()
    await storeTransactions(transactions, session)
    await storeBlock(block, session)
    await session.commitTransaction()


    lastBlockHash = block.hash.toString()

    return number + 1
}

async function storeBlock(block: any, session: ClientSession) {
    await BlockModel.insertMany([block], { session })
    console.log('inserted block', block.hash)
}

async function storeTransactions(transactions: any[], session: ClientSession) {
    const insertedTxs = await TransactionModel.insertMany(transactions, { session })
    console.log(`added ${insertedTxs.length} transactions`)
}

function prepareBlock(blockData: Block, encodedBlock: string) {
    return {
        hash: blockData.getHash(),
        previous_block: blockData.header.previous_block,
        number: blockData.header.number,
        transaction_count: blockData.transactions.length,
        transactions: blockData.transactions.map(tx => tx.getId()),
    }
}

function prepareTransaction(transaction: Transaction, mvsdTransaction, height) {
    if (transaction.getId() !== mvsdTransaction.hash) {
        throw Error(`Transaction mismatch on ${transaction.getId()} and ${mvsdTransaction.hash}`)
    }
    return {
        txid: mvsdTransaction.hash,
        height,
        data: transaction.toString(),
        addresses: compact(uniq(flatten([
            mvsdTransaction.inputs.map(input => input.address),
            mvsdTransaction.outputs.map(output => output.address),
        ])))
    }
}

async function applyFork(height: number) {
    console.info(`apply fork from block height ${height}`)
    const removedTxs = await TransactionModel.deleteMany({ height: { $gte: height } })
    console.info(`removed ${removedTxs.deletedCount} transactions`)
    const removedBlocks = await BlockModel.deleteMany({ number: { $gte: height } })
    console.info(`removed ${removedBlocks.deletedCount} blocks`)
}