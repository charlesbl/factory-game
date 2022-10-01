import React from 'react'
import '../css/Machine.css'
import Machine from '../Game/Machine'
import IngredientsView from './IngredientsView'

interface IManualMachineProps {
    machine: Machine
}

const ManualMachineView = (props: IManualMachineProps): JSX.Element => {
    const actions: JSX.Element[] = []
    const canCraft = true // TODO implement if user can manually craft

    const craftBtn = <button onMouseDown={() => { props.machine.active = true }}
        onMouseUp={() => { props.machine.active = false }}
        onMouseOut={() => { props.machine.active = false }}
        className="btn btn-success btn-side btn-craft" disabled={!canCraft}>
        <i className="fas fa-hammer fa-xs"></i>
    </button>
    actions.push(craftBtn)
    return (
        <div className="machine">
            <div className="name">{props.machine.name}</div>
            <div className="wrapper">
                <IngredientsView ingredients={props.machine.craft.input} />
                <div>
                    <div className="arrow"><i className="fas fa-arrow-right fa-10px"></i></div>
                    {actions.map((btn, i) => <div key={i} className="btn-wrapper">{btn}</div>)}
                </div>
                <IngredientsView ingredients={props.machine.craft.output} />
            </div>
        </div>
    )
}
export default ManualMachineView
