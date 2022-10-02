import React from 'react'
import '../css/Machine.css'
import Machine from '../Game/Machine'
import IngredientsView from './IngredientsView'

interface IMachineProps {
    machine: Machine
    onDeleteMachine: () => void
    onTogglePauseMachine: () => void
}

const MachineView = (props: IMachineProps): JSX.Element => {
    return (
        <div className="machine">
            <div className="name">
                {props.machine.name}
            </div>

            <div className="wrapper">
                <IngredientsView ingredients={props.machine.craft.input} />

                <div>
                    <div className="arrow">
                        <i className="fas fa-arrow-right fa-10px" />
                    </div>

                    <div>
                        58%
                    </div>

                    <div className="btn-wrapper">
                        <button
                            className="btn btn-warning btn-side"
                            onClick={() => props.onTogglePauseMachine?.()}
                        >
                            {!props.machine.active ? <i className="fas fa-play fa-xs" /> : <i className="fas fa-pause fa-xs" />}
                        </button>

                        <button
                            className="btn btn-danger btn-side"
                            onClick={() => props.onDeleteMachine?.()}
                        >
                            <i className="fas fa-trash fa-xs" />
                        </button>
                    </div>
                </div>

                <IngredientsView ingredients={props.machine.craft.output} />
            </div>
        </div>
    )
}
export default MachineView
