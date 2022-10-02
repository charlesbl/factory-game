import React from 'react'
import '../css/Machine.css'
import Inventory from '../Game/Inventory'
import Machine from '../Game/Machine'
import IngredientsView from './IngredientsView'

interface IManualMachineProps {
    machine: Machine
    inventory: Inventory
}

const ManualMachineView = (props: IManualMachineProps): JSX.Element => {
    const canCraft = props.machine.craft.canCraft(props.inventory, 1)

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

                    <div className="btn-wrapper">
                        <button
                            className="btn btn-success btn-side btn-craft"
                            disabled={!canCraft}
                            onMouseDown={() => { props.machine.active = true }}
                            onMouseOut={() => { props.machine.active = false }}
                            onMouseUp={() => { props.machine.active = false }}
                        >
                            <i className="fas fa-hammer fa-xs" />
                        </button>
                    </div>
                </div>

                <IngredientsView ingredients={props.machine.craft.output} />
            </div>
        </div>
    )
}
export default ManualMachineView
