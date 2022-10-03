import React from 'react'
import MachineCraft from '../Game/MachineCraft'
import IngredientsView from './IngredientsView'
import '../css/MachineCraft.css'

interface IMachineCraftProps {
    machineCraft: MachineCraft
    afordable: boolean
    onAdd: (machineCraft: MachineCraft) => void
    onRemove: (machineCraft: MachineCraft) => void
}

const MachineCraftView = (props: IMachineCraftProps): JSX.Element => {
    return (
        <div className="machine-craft">
            <div className="name">
                {props.machineCraft.name}
            </div>

            <div className="wrapper">
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

            <div>
                <IngredientsView ingredients={props.machineCraft.input} />
            </div>
        </div>
    )
}
export default MachineCraftView
