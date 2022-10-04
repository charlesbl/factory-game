import React from 'react'
import MachineCraft from '../Game/MachineCraft'
import IngredientsView from './IngredientsView'
import '../css/MachineCraft.css'
import useLocalStorageState from 'use-local-storage-state'

interface IMachineCraftProps {
    machineCraft: MachineCraft
    afordable: boolean
    onAdd: (machineCraft: MachineCraft) => void
    onRemove: (machineCraft: MachineCraft) => void
}

const MachineCraftView = (props: IMachineCraftProps): JSX.Element => {
    const [isMinimized, setIsMinimized] = useLocalStorageState('isMinimized' + props.machineCraft.id, { defaultValue: false })

    return (
        <div className="machine-craft">
            <div className="name">
                {props.machineCraft.name}
            </div>

            <button
                className='btn btn-secondary'
                onClick={() => setIsMinimized(!isMinimized)}
            >
                -
            </button>

            <div
                className="wrapper"
                hidden={isMinimized}
            >
                <IngredientsView ingredients={props.machineCraft.outputCraft.input} />

                <div>
                    <div className="arrow">
                        <i className="fas fa-arrow-right fa-10px" />
                    </div>

                    <div>
                    58%
                    </div>

                    <div className="btn-wrapper">
                        <button
                            className="btn btn-primary"
                            disabled={!props.afordable}
                            onClick={() => props.onAdd(props.machineCraft)}
                        >
                        +
                        </button>

                        {props.machineCraft.isCustom && (
                            <button
                                className="btn btn-danger"
                                onClick={() => props.onRemove(props.machineCraft)}
                            >
                                <i className="fas fa-trash fa-xs" />
                            </button>
                        )}
                    </div>
                </div>

                <IngredientsView ingredients={props.machineCraft.outputCraft.output} />
            </div>

            <div hidden={isMinimized} >
                <IngredientsView
                    ingredients={props.machineCraft.input}
                />
            </div>
        </div>
    )
}
export default MachineCraftView
